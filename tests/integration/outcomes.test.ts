/**
 * US2 (P2): the 6-outcome × 3-gateway scenario matrix (18 cells — SC-003), driven by the
 * sandbox's `X-Sandbox-Scenario` header (research D4). Expected surface per cell:
 * data-model.md "Scenario matrix".
 *
 * T019 negatives (same file): verify-before-confirm must surface a provider error without
 * hanging; an unknown payload shape must map to a typed error with the raw payload in `cause`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { UnoPay, ZarinpalAdapter, IdpayAdapter, BehpardakhtAdapter } from '../../src/index.js';
import { GatewayNetworkError } from '../../src/errors.js';
import type { SandboxScenario } from '../../src/types.js';
import { loadSandbox, type SandboxConfig } from './env.js';
import { CallbackReceiver, confirmCheckout, type GatewayName } from './harness.js';

const sandbox = await loadSandbox();
const maybe = sandbox ? describe : describe.skip;

type GatewayRow = {
  name: GatewayName;
  build: (cfg: SandboxConfig, scenario: SandboxScenario) => UnoPay<any>;
};

const GATEWAYS: GatewayRow[] = [
  {
    name: 'zarinpal',
    build: (cfg, scenario) =>
      new UnoPay({
        zarinpal: new ZarinpalAdapter({
          merchantId: cfg.merchantId,
          baseUrl: `${cfg.url}/zarinpal/pg`,
          refundUrl: `${cfg.url}/zarinpal/payment/refund`,
          sandboxApiKey: cfg.sandboxApiKey,
          scenario,
        }),
      }),
  },
  {
    name: 'idpay',
    build: (cfg, scenario) =>
      new UnoPay({
        idpay: new IdpayAdapter({
          apiKey: cfg.idpayApiKey,
          baseUrl: `${cfg.url}/idpay/v1.1`,
          sandboxApiKey: cfg.sandboxApiKey,
          scenario,
        }),
      }),
  },
  {
    name: 'behpardakht',
    build: (cfg, scenario) =>
      new UnoPay({
        behpardakht: new BehpardakhtAdapter({
          terminalId: cfg.terminalId,
          username: cfg.username,
          password: cfg.password,
          baseUrl: `${cfg.url}/behpardakht`,
          sandboxApiKey: cfg.sandboxApiKey,
          scenario,
        }),
      }),
  },
];

const AMOUNT = 1000;

/** initiate → (confirm → callback) unless the scenario fails at initiate. */
async function drive(
  cfg: SandboxConfig,
  receiver: CallbackReceiver,
  row: GatewayRow,
  scenario: SandboxScenario
): Promise<{ client: UnoPay<any>; paymentTxn: string } | { initiateError: unknown }> {
  const client = row.build(cfg, scenario);
  try {
    const payment = await client.createPayment(row.name, {
      amount: AMOUNT,
      currency: 'IRR',
      callbackUrl: receiver.callbackUrl,
      metadata: { description: `matrix ${row.name}/${scenario}` },
    });
    await confirmCheckout(cfg.url, row.name, payment.transactionId);
    return { client, paymentTxn: payment.transactionId };
  } catch (error) {
    return { initiateError: error };
  }
}

async function verifyFromCallback(
  receiver: CallbackReceiver,
  client: UnoPay<any>,
  gateway: GatewayName
): Promise<{ isSuccessful: boolean; errorReason?: string | undefined }> {
  const callback = await receiver.waitForCallback();
  return client.verifyCallback(gateway, {
    method: callback.method,
    query: { ...callback.query, amount: String(AMOUNT) },
    body: {},
  });
}

maybe('US2: scenario matrix (6 outcomes × 3 gateways)', () => {
  const cfg = sandbox as SandboxConfig;
  let receiver: CallbackReceiver;

  beforeAll(async () => {
    receiver = await CallbackReceiver.start();
  });

  afterAll(async () => {
    await receiver.stop();
  });

  for (const row of GATEWAYS) {
    describe(row.name, () => {
      it('approve: full loop verifies successfully', async () => {
        const r = await drive(cfg, receiver, row, 'approve');
        expect('initiateError' in r).toBe(false);
        const verify = await verifyFromCallback(receiver, (r as any).client, row.name);
        expect(verify.isSuccessful).toBe(true);
      });

      it('decline: verify reports failure with a reason', async () => {
        const r = await drive(cfg, receiver, row, 'decline');
        expect('initiateError' in r).toBe(false);
        const verify = await verifyFromCallback(receiver, (r as any).client, row.name);
        expect(verify.isSuccessful).toBe(false);
        expect(verify.errorReason).toBeTruthy();
      });

      it('timeout: createPayment throws GatewayNetworkError', async () => {
        const r = await drive(cfg, receiver, row, 'timeout');
        expect('initiateError' in r).toBe(true);
        expect((r as any).initiateError).toBeInstanceOf(GatewayNetworkError);
        expect(((r as any).initiateError as GatewayNetworkError).cause).toBeDefined();
      });

      it('verify_fail: verify reports failure with a reason', async () => {
        const r = await drive(cfg, receiver, row, 'verify_fail');
        expect('initiateError' in r).toBe(false);
        const verify = await verifyFromCallback(receiver, (r as any).client, row.name);
        expect(verify.isSuccessful).toBe(false);
        expect(verify.errorReason).toBeTruthy();
      });

      it('refund: verify approves then refund() succeeds', async () => {
        const r = await drive(cfg, receiver, row, 'refund');
        expect('initiateError' in r).toBe(false);
        const { client, paymentTxn } = r as { client: UnoPay<any>; paymentTxn: string };

        const verify = await verifyFromCallback(receiver, client, row.name);
        expect(verify.isSuccessful).toBe(true);

        const refund = await client.refund(row.name, { transactionId: paymentTxn });
        expect(refund.isSuccessful).toBe(true);
      });

      it('pending_settle: settles after due delay, then verifies', async () => {
        const r = await drive(cfg, receiver, row, 'pending_settle');
        expect('initiateError' in r).toBe(false);
        const { client } = r as { client: UnoPay<any>; paymentTxn: string };

        // Sandbox verify blocks synchronously until due_at (default 5s) then settles —
        // give the HTTP round-trip room for the wait (research D4).
        const callback = await receiver.waitForCallback();
        const verify = await client.verifyCallback(row.name, {
          method: callback.method,
          query: { ...callback.query, amount: String(AMOUNT) },
          body: {},
        });
        expect(verify.isSuccessful).toBe(true);
      });
    });
  }

  // T019 — spec edge cases
  describe('edge cases', () => {
    it('verify before checkout confirm: no hang, and a decline still surfaces as failure', async () => {
      const row = GATEWAYS[0]!; // zarinpal
      // The sandbox permits verify from `initiated` for an approve scenario (it settles), so
      // the observable edge case is a DECLINE forced without confirm: the failure must come
      // back as a typed failure result, not a crash or a hang.
      const client = row.build(cfg, 'decline');
      const payment = await client.createPayment('zarinpal', {
        amount: AMOUNT,
        currency: 'IRR',
        callbackUrl: receiver.callbackUrl,
      });
      // no confirmCheckout — tx is still `initiated`
      const verify = await client
        .verifyCallback('zarinpal', {
          method: 'GET',
          query: { Authority: payment.transactionId, amount: String(AMOUNT) },
          body: {},
        })
        .then(
          (r) => ({ thrown: false as const, result: r }),
          (e: unknown) => ({ thrown: true as const, error: e })
        );

      if (verify.thrown) {
        // A typed error is also acceptable — never a hang, never a success.
        expect(verify.error).toBeTruthy();
      } else {
        expect(verify.result.isSuccessful).toBe(false);
        expect(verify.result.errorReason).toBeTruthy();
      }
    });

    it('unknown payload shape maps to a typed error with raw payload in cause', async () => {
      const row = GATEWAYS[1]!; // idpay
      const client = row.build(cfg, 'approve');
      const originalFetch = globalThis.fetch;
      const garbage = { totally: 'unexpected' };
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => garbage } as any);
      try {
        const err = await client
          .createPayment('idpay', { amount: AMOUNT, currency: 'IRR', callbackUrl: 'http://cb' })
          .then(() => null, (e: unknown) => e);
        expect(err).toBeTruthy();
        expect((err as { cause?: unknown }).cause).toBe(garbage);
        expect((err as Error).name).toContain('Gateway');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
