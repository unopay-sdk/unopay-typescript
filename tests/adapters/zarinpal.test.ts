import { describe, it, expect, vi, afterEach } from 'vitest';
import { ZarinpalAdapter } from '../../src/adapters/zarinpal.js';
import { PaymentValidationError, GatewayNetworkError, GatewayProviderError } from '../../src/errors.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ZarinpalAdapter', () => {
  it('should throw on empty merchantId', () => {
    expect(() => new ZarinpalAdapter({ merchantId: '' })).toThrow(PaymentValidationError);
  });

  it('should successfully create a payment', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'test-merchant', sandbox: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, authority: 'S123' }, errors: [] }),
    } as any);

    const result = await adapter.createPayment({ amount: 1000, currency: 'IRR', callbackUrl: 'http://cb' });
    expect(result.transactionId).toBe('S123');
  });

  it('should handle network errors', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'test' });
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    await expect(adapter.createPayment({ amount: 1000, currency: 'IRR', callbackUrl: 'cb' }))
      .rejects.toThrow(GatewayNetworkError);
  });

  it('should verify payment successfully', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'test-merchant' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, ref_id: 123456 }, errors: [] }),
    } as any);

    const result = await adapter.verifyCallback({ query: { Authority: 'S123', amount: '1000' }, body: {}, method: 'GET' });
    expect(result.isSuccessful).toBe(true);
    expect(result.transactionId).toBe('123456');
  });

  it('should prefer baseUrl over the sandbox flag', async () => {
    const adapter = new ZarinpalAdapter({
      merchantId: 'm',
      sandbox: true,
      baseUrl: 'http://localhost:8080/zarinpal/pg',
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, authority: 'A1' }, errors: [] }),
    } as any);

    const result = await adapter.createPayment({ amount: 100, currency: 'IRR', callbackUrl: 'cb' });
    expect((global.fetch as any).mock.calls[0][0]).toBe('http://localhost:8080/zarinpal/pg/v4/payment/request.json');
    expect(result.redirectUrl).toBe('http://localhost:8080/zarinpal/pg/StartPay/A1');
  });

  it('should send X-Sandbox-Scenario on initiate only when scenario is set', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'm', scenario: 'decline' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, authority: 'A2' }, errors: [] }),
    } as any);

    await adapter.createPayment({ amount: 100, currency: 'IRR', callbackUrl: 'cb' });
    expect((global.fetch as any).mock.calls[0][1].headers['X-Sandbox-Scenario']).toBe('decline');

    const plain = new ZarinpalAdapter({ merchantId: 'm' });
    await plain.createPayment({ amount: 100, currency: 'IRR', callbackUrl: 'cb' });
    expect((global.fetch as any).mock.calls[1][1].headers['X-Sandbox-Scenario']).toBeUndefined();
  });

  it('should map in-band timeout (-33) to GatewayNetworkError with payload preserved', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'm', scenario: 'timeout' });
    const payload = { data: [], errors: [{ code: -33, message: 'Payment session expired' }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as any);

    const err = await adapter
      .createPayment({ amount: 100, currency: 'IRR', callbackUrl: 'cb' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayNetworkError);
    expect((err as GatewayNetworkError).cause).toBe(payload);
  });

  it('should refund via the configured refundUrl', async () => {
    const adapter = new ZarinpalAdapter({
      merchantId: 'm',
      refundUrl: 'http://localhost:8080/zarinpal/payment/refund',
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: 100, message: 'Payment refunded successfully', ref_id: 999 }),
    } as any);

    const result = await adapter.refund({ transactionId: 'A3' });
    expect((global.fetch as any).mock.calls[0][0]).toBe('http://localhost:8080/zarinpal/payment/refund');
    expect((global.fetch as any).mock.calls[0][1].body).toContain('"authority":"A3"');
    expect(result.isSuccessful).toBe(true);
    expect(result.refundId).toBe('999');
  });

  it('should surface a failed refund as isSuccessful=false', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'm', refundUrl: 'http://x/refund' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: -50, message: 'Refund not allowed for current transaction status' }),
    } as any);

    const result = await adapter.refund({ transactionId: 'A4' });
    expect(result.isSuccessful).toBe(false);
    expect(result.errorReason).toContain('Refund not allowed');
  });

  it('should reject non-100 initiate as GatewayProviderError with payload in cause', async () => {
    const adapter = new ZarinpalAdapter({ merchantId: 'm' });
    const payload = { data: [], errors: [{ code: -9, message: 'err' }] };
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload } as any);

    const err = await adapter
      .createPayment({ amount: 100, currency: 'IRR', callbackUrl: 'cb' })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayProviderError);
    expect((err as GatewayProviderError).cause).toBe(payload);
  });
});
