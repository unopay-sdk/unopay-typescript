import { describe, it, expect, vi } from 'vitest';
import { ZarinpalAdapter } from '../../src/adapters/zarinpal.js';
import { PaymentValidationError, GatewayNetworkError } from '../../src/errors.js';

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
});
