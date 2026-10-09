/**
 * US1 (P1): full payment lifecycle against the sandbox — initiate → redirect →
 * REAL sandbox callback captured by a local receiver → verify. FR-002/003/011, SC-001/002.
 *
 * Skips with a notice when UNOPAY_SANDBOX_URL is unset; fails the run when it is set
 * but unusable (FR-006 — logic in env.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UnoPay, ZarinpalAdapter, IdpayAdapter, BehpardakhtAdapter } from '../../src/index.js';
import { loadSandbox, type SandboxConfig } from './env.js';
import {
  CallbackReceiver,
  confirmCheckout,
  HostRecorder,
  type CapturedCallback,
  type GatewayName,
} from './harness.js';

const sandbox = await loadSandbox();
const maybe = sandbox ? describe : describe.skip;

function buildClient(cfg: SandboxConfig): UnoPay<any> {
  // Happy-path suite: ask the sandbox for `approve` explicitly. Without a header the project's
  // `default_scenario` decides, and a stack left on `decline` by an earlier experiment would
  // silently fail every cell here (quickstart step 2 resets it for the same reason).
  return new UnoPay({
    zarinpal: new ZarinpalAdapter({
      merchantId: cfg.merchantId,
      baseUrl: `${cfg.url}/zarinpal/pg`,
      refundUrl: `${cfg.url}/zarinpal/payment/refund`,
      sandboxApiKey: cfg.sandboxApiKey,
      scenario: 'approve',
    }),
    idpay: new IdpayAdapter({
      apiKey: cfg.idpayApiKey,
      baseUrl: `${cfg.url}/idpay/v1.1`,
      sandboxApiKey: cfg.sandboxApiKey,
      scenario: 'approve',
    }),
    behpardakht: new BehpardakhtAdapter({
      terminalId: cfg.terminalId,
      username: cfg.username,
      password: cfg.password,
      baseUrl: `${cfg.url}/behpardakht`,
      sandboxApiKey: cfg.sandboxApiKey,
      scenario: 'approve',
    }),
  });
}

async function runLifecycle(
  cfg: SandboxConfig,
  receiver: CallbackReceiver,
  gateway: GatewayName,
  client: UnoPay<any>
): Promise<CapturedCallback> {
  const payment = await client.createPayment(gateway, {
    amount: 1000,
    currency: 'IRR',
    callbackUrl: receiver.callbackUrl,
    metadata: { description: `US1 ${gateway}` },
  });
  expect(payment.transactionId).toBeTruthy();
  expect(payment.redirectUrl.startsWith(cfg.url)).toBe(true);

  await confirmCheckout(cfg.url, gateway, payment.transactionId);
  const callback = await receiver.waitForCallback();

  const verify = await client.verifyCallback(gateway, {
    method: callback.method,
    query: { ...callback.query, amount: '1000' },
    body: {},
  });
  expect(verify.isSuccessful).toBe(true);
  expect(verify.transactionId).toBeTruthy();
  return callback;
}

maybe('US1: full lifecycle against the sandbox', () => {
  const cfg = sandbox as SandboxConfig;
  let receiver: CallbackReceiver;
  let recorder: HostRecorder;
  let client: UnoPay<any>;

  beforeAll(async () => {
    receiver = await CallbackReceiver.start();
    recorder = new HostRecorder();
    recorder.install();
    client = buildClient(cfg);
  });

  afterAll(async () => {
    recorder.restore();
    await receiver.stop();
  });

  it('zarinpal: initiate → confirm → real callback → verify', async () => {
    const cb = await runLifecycle(cfg, receiver, 'zarinpal', client);
    expect(cb.query.Authority).toBeTruthy();
    expect(cb.query.Status).toBe('OK');
  });

  it('idpay: initiate → confirm → real callback → verify', async () => {
    const cb = await runLifecycle(cfg, receiver, 'idpay', client);
    expect(cb.query.id).toBeTruthy();
    expect(cb.query.status).toBe('10');
    expect(cb.query.order_id).toBeTruthy();
  });

  it('behpardakht: initiate → confirm → real callback → verify', async () => {
    const cb = await runLifecycle(cfg, receiver, 'behpardakht', client);
    expect(cb.query.ResCode).toBe('0');
    expect(cb.query.RefId).toBeTruthy();
    expect(cb.query.SaleOrderId).toBeTruthy();
  });

  it('SC-002: every outbound request stayed on the sandbox or receiver host', () => {
    const allowed = [new URL(cfg.url).host, receiver.host];
    recorder.assertOnly(allowed);
    expect(recorder.urls.length).toBeGreaterThan(0);
  });
});
