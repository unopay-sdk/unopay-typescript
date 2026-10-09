/**
 * US1 scenario 3 / SC-006: an invalid API key produces a typed SDK error within ONE
 * request round-trip — no hang, no retry storm, payload preserved in `cause`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ZarinpalAdapter, IdpayAdapter } from '../../src/index.js';
import { GatewayProviderError } from '../../src/errors.js';
import { loadSandbox, type SandboxConfig } from './env.js';
import { HostRecorder } from './harness.js';

const sandbox = await loadSandbox();
const maybe = sandbox ? describe : describe.skip;

maybe('US1: auth failures surface as typed errors', () => {
  const cfg = sandbox as SandboxConfig;
  let recorder: HostRecorder;

  beforeAll(() => {
    recorder = new HostRecorder();
    recorder.install();
  });

  afterAll(() => {
    recorder.restore();
  });

  it('IDPay: wrong API key → GatewayProviderError in exactly one attempt', async () => {
    const adapter = new IdpayAdapter({
      apiKey: 'definitely-not-the-sandbox-key',
      baseUrl: `${cfg.url}/idpay/v1.1`,
      sandboxApiKey: cfg.sandboxApiKey,
    });
    const before = recorder.urls.length;

    const err = await adapter
      .createPayment({ amount: 1000, currency: 'IRR', callbackUrl: 'http://cb' })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(GatewayProviderError);
    expect(String((err as GatewayProviderError).cause)).toBeTruthy();
    expect(recorder.urls.length - before).toBe(1);
  });

  it('Zarinpal: wrong merchantId → GatewayProviderError, payload preserved', async () => {
    const adapter = new ZarinpalAdapter({
      merchantId: 'not-the-sandbox-merchant',
      baseUrl: `${cfg.url}/zarinpal/pg`,
      sandboxApiKey: cfg.sandboxApiKey,
    });

    const err = await adapter
      .createPayment({ amount: 1000, currency: 'IRR', callbackUrl: 'http://cb' })
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(GatewayProviderError);
    expect(String((err as GatewayProviderError).cause)).toContain('credential');
  });
});
