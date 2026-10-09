import { describe, it, expect, vi, afterEach } from 'vitest';
import { IdpayAdapter } from '../../src/adapters/idpay.js';
import { PaymentValidationError, GatewayNetworkError, GatewayProviderError } from '../../src/errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function okJson(payload: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as any);
}

describe('IdpayAdapter', () => {
  it('requires an apiKey', () => {
    expect(() => new IdpayAdapter({ apiKey: '' })).toThrow(PaymentValidationError);
  });

  it('initiates with X-API-KEY and builds redirect from baseUrl (sandbox path link)', async () => {
    const adapter = new IdpayAdapter({
      apiKey: 'sandbox-key',
      baseUrl: 'http://localhost:8080/idpay/v1.1',
    });
    global.fetch = okJson({ id: 'pay-1', link: '/idpay/payment/start/pay-1' });

    const result = await adapter.createPayment({ amount: 500, currency: 'IRR', callbackUrl: 'http://cb' });
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('http://localhost:8080/idpay/v1.1/payment');
    expect(init.headers['X-API-KEY']).toBe('sandbox-key');
    expect(JSON.parse(init.body).callback).toBe('http://cb');
    expect(result.transactionId).toBe('pay-1');
    expect(result.redirectUrl).toBe('http://localhost:8080/idpay/payment/start/pay-1');
  });

  it('passes an absolute production link through unchanged', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k' });
    global.fetch = okJson({ id: 'p1', link: 'https://idpay.ir/p/ABC' });

    const result = await adapter.createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' });
    expect(result.redirectUrl).toBe('https://idpay.ir/p/ABC');
  });

  it('sends X-Sandbox-Scenario on initiate when configured', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k', scenario: 'decline' });
    global.fetch = okJson({ id: 'x', link: '/l' });

    await adapter.createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' });
    expect((global.fetch as any).mock.calls[0][1].headers['X-Sandbox-Scenario']).toBe('decline');
  });

  it('maps in-band timeout error_code 51 to GatewayNetworkError', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k', scenario: 'timeout' });
    const payload = { error_code: 51, error_message: 'Payment session expired' };
    global.fetch = okJson(payload);

    const err = await adapter
      .createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayNetworkError);
    expect((err as GatewayNetworkError).cause).toBe(payload);
  });

  it('verifies from callback query (status 100 = success)', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k' });
    global.fetch = okJson({ status: 100, track_id: 42, id: 'pay-1' });

    const result = await adapter.verifyCallback({
      method: 'GET',
      query: { id: 'pay-1', order_id: 'o1', status: '10', amount: '500' },
      body: {},
    });
    expect(result.isSuccessful).toBe(true);
    expect((global.fetch as any).mock.calls[0][1].body).toBe('{"id":"pay-1","order_id":"o1"}');
  });

  it('returns isSuccessful=false on decline status 50 with reason', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k' });
    global.fetch = okJson({ status: 50, error_message: 'Payment failed / declined' });

    const result = await adapter.verifyCallback({ method: 'GET', query: { id: 'p' }, body: {} });
    expect(result.isSuccessful).toBe(false);
    expect(result.errorReason).toContain('declined');
  });

  it('requires id for verification', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k' });
    await expect(adapter.verifyCallback({ method: 'GET', query: {}, body: {} })).rejects.toThrow(
      PaymentValidationError
    );
  });

  it('refunds with status 200 = success, 51 = failure', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'k' });
    global.fetch = okJson({ status: 200, track_id: 7 });
    const ok = await adapter.refund({ transactionId: 'pay-1' });
    expect(ok.isSuccessful).toBe(true);
    expect(ok.refundId).toBe('7');

    global.fetch = okJson({ status: 51, error_message: 'Refund not allowed for current transaction status' });
    const bad = await adapter.refund({ transactionId: 'pay-1' });
    expect(bad.isSuccessful).toBe(false);
    expect(bad.errorReason).toContain('Refund not allowed');
  });

  it('rejects non-ok HTTP with GatewayProviderError', async () => {
    const adapter = new IdpayAdapter({ apiKey: 'wrong' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"invalid api key"}',
    } as any);

    const err = await adapter
      .createPayment({ amount: 1, currency: 'IRR', callbackUrl: 'cb' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayProviderError);
    expect(String((err as GatewayProviderError).cause)).toContain('invalid api key');
  });
});
