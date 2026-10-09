import { GatewayNetworkError, GatewayProviderError, PaymentValidationError } from '../errors.js';
import type {
  PaymentRequest,
  PaymentResult,
  VerificationResult,
  CallbackRequest,
  RefundRequest,
  RefundResult,
  SandboxScenario,
} from '../types.js';
import type { GatewayAdapter } from './base.js';
import type { PaymentLogger } from '../logger.js';
import { request } from '../http.js';
import { toRials } from '../currency.js';

export interface ZarinpalConfig {
  merchantId: string;
  sandbox?: boolean;
  /** Explicit endpoint base — wins over `sandbox`. e.g. `${UNOPAY_SANDBOX_URL}/zarinpal/pg`. */
  baseUrl?: string;
  /** Refund endpoint override; the ipg-sandbox serves refunds off the v4 surface. */
  refundUrl?: string;
  /**
   * Sandbox host's project API key (`ipg_key_…`). Sent as `Authorization: Bearer …` so a
   * cloud-hosted sandbox scopes requests to that key's project. Omitted for local self-host.
   */
  sandboxApiKey?: string;
  /** Sends `X-Sandbox-Scenario` on initiate when set (ipg-sandbox outcome forcing). */
  scenario?: SandboxScenario;
  logger?: PaymentLogger;
}

export class ZarinpalAdapter implements GatewayAdapter {
  private baseUrl: string;

  constructor(private config: ZarinpalConfig) {
    if (!config.merchantId) {
      throw new PaymentValidationError('Zarinpal requires a valid merchantId');
    }
    this.baseUrl =
      config.baseUrl ??
      (config.sandbox ? 'https://sandbox.zarinpal.com/pg' : 'https://payment.zarinpal.com/pg');
  }

  private authHeaders(withScenario: boolean): Record<string, string> | undefined {
    const headers: Record<string, string> = {};
    if (this.config.sandboxApiKey) {
      headers['Authorization'] = `Bearer ${this.config.sandboxApiKey}`;
    }
    if (withScenario && this.config.scenario) {
      headers['X-Sandbox-Scenario'] = this.config.scenario;
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
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
      },
      headers: this.authHeaders(true),
    });

    // In-band timeout (sandbox scenario or provider session expiry) is a timeout, not a
    // generic provider failure — surfaces as GatewayNetworkError (spec US2-2).
    const errCode = data.errors?.[0]?.code;
    if (data.data?.code === -33 || errCode === -33) {
      throw new GatewayNetworkError('Zarinpal payment session expired (timeout)', data);
    }

    if (data.data?.code !== 100) {
      throw new GatewayProviderError(
        `Zarinpal request rejected: ${data.data?.message || data.errors?.[0]?.message || 'Unknown error'}`,
        data
      );
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
      },
      headers: this.authHeaders(false),
    });

    const code = data.data?.code;
    const isSuccessful = code === 100 || code === 101;

    return {
      isSuccessful,
      transactionId: data.data?.ref_id ? String(data.data.ref_id) : authority,
      settledAmount: amount,
      errorReason: isSuccessful
        ? undefined
        : data.data?.message || data.errors?.[0]?.message || 'Verification failed',
    };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const url = this.config.refundUrl ?? `${this.baseUrl}/v4/payment/refund.json`;
    const data = await request<any>(url, {
      method: 'POST',
      body: {
        merchant_id: this.config.merchantId,
        authority: req.transactionId,
        ...(req.amount !== undefined ? { amount: req.amount } : {}),
        ...(req.metadata ?? {}),
      },
      headers: this.authHeaders(false),
    });

    const code = data.code ?? data.data?.code;
    const isSuccessful = code === 100;
    const refId = data.ref_id ?? data.data?.ref_id;
    return {
      isSuccessful,
      refundId: refId !== undefined && refId !== null ? String(refId) : undefined,
      errorReason: isSuccessful
        ? undefined
        : data.message || data.data?.message || 'Refund failed',
    };
  }
}
