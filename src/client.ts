import type { PaymentRequest, PaymentResult, VerificationResult, CallbackRequest } from './types.js';
import type { PaymentLogger } from './logger.js';
import type { GatewayAdapter } from './adapters/base.js';
import { PaymentError, GatewayProviderError } from './errors.js';

export class UnoPay<TGateways extends Record<string, GatewayAdapter>> {
  constructor(
    private adapters: TGateways,
    private logger?: PaymentLogger
  ) {}

  async createPayment<K extends keyof TGateways>(
    provider: K,
    request: PaymentRequest
  ): Promise<PaymentResult> {
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new PaymentError(`Adapter for provider ${String(provider)} not found.`, 'ADAPTER_NOT_FOUND');
    }

    this.logger?.info('payment_started', { provider, request });

    try {
      this.logger?.info('provider_request_sent', { provider, request });
      return await adapter.createPayment(request);
    } catch (error) {
      this.logger?.error('payment_failed', { provider, error });
      if (error instanceof PaymentError) throw error;
      throw new GatewayProviderError(`Payment creation failed for ${String(provider)}`, error);
    }
  }

  async verifyCallback<K extends keyof TGateways>(
    provider: K,
    request: CallbackRequest
  ): Promise<VerificationResult> {
    const adapter = this.adapters[provider];
    if (!adapter) {
      throw new PaymentError(`Adapter for provider ${String(provider)} not found.`, 'ADAPTER_NOT_FOUND');
    }

    try {
      const result = await adapter.verifyCallback(request);
      this.logger?.info('verification_completed', { provider, result });
      return result;
    } catch (error) {
      this.logger?.error('verification_failed', { provider, error });
      if (error instanceof PaymentError) throw error;
      throw new GatewayProviderError(`Verification failed for ${String(provider)}`, error);
    }
  }
}
