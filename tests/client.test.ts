import { describe, it, expect, vi } from 'vitest';
import { UnoPay } from '../src/client.js';
import { GatewayAdapter } from '../src/adapters/base.js';
import { GatewayProviderError, PaymentError } from '../src/errors.js';

const dummyAdapter: GatewayAdapter = {
  createPayment: async () => ({ redirectUrl: 'url', transactionId: '1', providerToken: 'token' }),
  verifyCallback: async () => ({ isSuccessful: true, transactionId: '1', settledAmount: 1000 }),
  refund: async () => ({ isSuccessful: true, refundId: 'r1' }),
};

describe('UnoPay Client', () => {
  it('should route to the correct adapter', async () => {
    const unopay = new UnoPay({ dummy: dummyAdapter });
    const res = await unopay.createPayment('dummy', { amount: 1000, currency: 'IRR', callbackUrl: '' });
    expect(res.transactionId).toBe('1');
  });

  it('should log lifecycle events', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const unopay = new UnoPay({ dummy: dummyAdapter }, logger);

    await unopay.createPayment('dummy', { amount: 1000, currency: 'IRR', callbackUrl: '' });
    expect(logger.info).toHaveBeenCalledWith('payment_started', expect.any(Object));
  });

  it('should dispatch refund to the correct adapter and log it', async () => {
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    const unopay = new UnoPay({ dummy: dummyAdapter }, logger);

    const result = await unopay.refund('dummy', { transactionId: '1' });
    expect(result.isSuccessful).toBe(true);
    expect(result.refundId).toBe('r1');
    expect(logger.info).toHaveBeenCalledWith('refund_started', expect.any(Object));
    expect(logger.info).toHaveBeenCalledWith('refund_completed', expect.any(Object));
  });

  it('should throw ADAPTER_NOT_FOUND for an unknown provider on refund', async () => {
    const unopay = new UnoPay({ dummy: dummyAdapter });
    await expect(unopay.refund('nope' as never, { transactionId: '1' })).rejects.toMatchObject({
      code: 'ADAPTER_NOT_FOUND',
    });
  });

  it('should wrap non-PaymentError refund failures in GatewayProviderError', async () => {
    const boom: GatewayAdapter = {
      ...dummyAdapter,
      refund: async () => {
        throw new Error('raw boom');
      },
    };
    const unopay = new UnoPay({ boom });
    const err = await unopay.refund('boom', { transactionId: '1' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayProviderError);
    expect((err as GatewayProviderError).message).toContain('Refund failed for boom');
    expect((err as GatewayProviderError).cause).toBeInstanceOf(Error);
  });
});
