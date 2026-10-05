import { describe, it, expect, vi } from 'vitest';
import { UnoPay } from '../src/client.js';
import { GatewayAdapter } from '../src/adapters/base.js';

const dummyAdapter: GatewayAdapter = {
  createPayment: async () => ({ redirectUrl: 'url', transactionId: '1', providerToken: 'token' }),
  verifyCallback: async () => ({ isSuccessful: true, transactionId: '1', settledAmount: 1000 }),
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
});
