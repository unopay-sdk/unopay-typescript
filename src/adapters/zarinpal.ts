import type { GatewayAdapter } from './base.js';
import type { PaymentRequest, PaymentResult, VerificationResult, CallbackRequest } from '../types.js';
import type { PaymentLogger } from '../logger.js';
import { PaymentValidationError, GatewayProviderError } from '../errors.js';
import { request } from '../http.js';
import { toRials } from '../currency.js';

export interface ZarinpalConfig {
  merchantId: string;
  sandbox?: boolean;
  logger?: PaymentLogger;
}

export class ZarinpalAdapter implements GatewayAdapter {
  private baseUrl: string;

  constructor(private config: ZarinpalConfig) {
    if (!config.merchantId) {
      throw new PaymentValidationError('Zarinpal requires a valid merchantId');
    }
    this.baseUrl = config.sandbox
      ? 'https://sandbox.zarinpal.com/pg'
      : 'https://payment.zarinpal.com/pg';
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    const url = `${this.baseUrl}/v4/payment/request.json`;
    const amountRials = toRials(req.amount, req.currency);

    const data = await request<any>(url, {
      method: 'POST',
      body: {
        merchant_id: this.config.merchantId,
        amount: amountRials,
        description: req.metadata?.description || 'Payment',
        callback_url: req.callbackUrl,
        metadata: req.metadata,
      }
    });

    if (data.data?.code !== 100) {
      throw new GatewayProviderError(`Zarinpal request rejected: ${data.data?.message || 'Unknown error'}`, data);
    }

    const authority = data.data.authority;
    return {
      redirectUrl: `${this.baseUrl}/StartPay/${authority}`,
      transactionId: authority,
      providerToken: authority,
    };
  }

  async verifyCallback(req: CallbackRequest): Promise<VerificationResult> {
    const authority = req.query.Authority || req.body.Authority;
    const amount = Number(req.query.amount || req.body.amount);

    if (!authority) {
      throw new PaymentValidationError('Authority is required for Zarinpal verification');
    }
    if (!amount || isNaN(amount)) {
      throw new PaymentValidationError('Amount is required for Zarinpal verification');
    }

    const url = `${this.baseUrl}/v4/payment/verify.json`;
    const data = await request<any>(url, {
      method: 'POST',
      body: {
        merchant_id: this.config.merchantId,
        amount: toRials(amount, req.query.currency || req.body.currency || 'IRR'),
        authority,
      }
    });

    const code = data.data?.code;
    const isSuccessful = code === 100 || code === 101;

    return {
      isSuccessful,
      transactionId: data.data?.ref_id ? String(data.data.ref_id) : authority,
      settledAmount: amount,
      errorReason: isSuccessful ? undefined : data.data?.message || 'Verification failed',
    };
  }
}
