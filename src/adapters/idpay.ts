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

export interface IdpayConfig {
  /** IDPay merchant API key — sent as the `X-API-KEY` header. */
  apiKey: string;
  /** Explicit endpoint base. Default: production `https://api.idpay.ir/v1.1`. */
  baseUrl?: string;
  /**
   * Sandbox host's project API key (`ipg_key_…`). Sent as `Authorization: Bearer …` so a
   * cloud-hosted sandbox scopes requests to that key's project. Omitted for local self-host.
   */
  sandboxApiKey?: string;
  /** Sends `X-Sandbox-Scenario` on initiate when set (ipg-sandbox outcome forcing). */
  scenario?: SandboxScenario;
  logger?: PaymentLogger;
}

export class IdpayAdapter implements GatewayAdapter {
  private baseUrl: string;

  constructor(private config: IdpayConfig) {
    if (!config.apiKey) {
      throw new PaymentValidationError('IDPay requires a valid apiKey');
    }
    this.baseUrl = config.baseUrl ?? 'https://api.idpay.ir/v1.1';
  }

  private authHeaders(withScenario = false): Record<string, string> {
    return {
      'X-API-KEY': this.config.apiKey,
      ...(this.config.sandboxApiKey ? { Authorization: `Bearer ${this.config.sandboxApiKey}` } : {}),
      ...(withScenario && this.config.scenario ? { 'X-Sandbox-Scenario': this.config.scenario } : {}),
    };
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    const url = `${this.baseUrl}/payment`;
    const amountRials = toRials(req.amount, req.currency);
    // Unique per call: the sandbox (and real IDPay) resolve payments by order_id, so a coarse
    // timestamp shared by concurrent payments would collide.
    const order_id = String(
      req.metadata?.orderId ?? `${Date.now()}${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`
    );

    const data = await request<any>(url, {
      method: 'POST',
      headers: this.authHeaders(true),
      body: {
        order_id,
        amount: amountRials,
        callback: req.callbackUrl,
        desc: req.metadata?.description || 'Payment',
        ...(req.metadata?.mobile ? { mobile: req.metadata.mobile } : {}),
      },
    });

    // In-band timeout (sandbox scenario / provider session expiry).
    if (data.error_code === 51) {
      throw new GatewayNetworkError('IDPay payment session expired (timeout)', data);
    }
    if (!data.id) {
      throw new GatewayProviderError(
        `IDPay request rejected: ${data.error_message || data.message || 'Unknown error'}`,
        data
      );
    }

    // Relative `link` (sandbox) resolves against the configured base; absolute `link`
    // (production) passes through unchanged — never adopt an untrusted host (research D8).
    const link = typeof data.link === 'string' && data.link.length > 0 ? data.link : `/payment/start/${data.id}`;
    return {
      redirectUrl: new URL(link, this.baseUrl).toString(),
      transactionId: data.id,
      providerToken: data.id,
    };
  }

  async verifyCallback(req: CallbackRequest): Promise<VerificationResult> {
    const id = req.query.id || req.body.id;
    const order_id = req.query.order_id || req.body.order_id || '';
    const amount = Number(req.query.amount || req.body.amount || 0);

    if (!id) {
      throw new PaymentValidationError('id is required for IDPay verification');
    }

    const data = await request<any>(`${this.baseUrl}/payment/verify`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: { id, order_id },
    });

    const status = data.status;
    const isSuccessful = status === 100 || status === 101;
    return {
      isSuccessful,
      transactionId: id,
      settledAmount: amount,
      errorReason: isSuccessful
        ? undefined
        : data.error_message || data.message || `Verification failed (status ${status})`,
    };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    const data = await request<any>(`${this.baseUrl}/payment/refund`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: {
        id: req.transactionId,
        ...(req.amount !== undefined ? { amount: req.amount } : {}),
        ...(req.metadata ?? {}),
      },
    });

    // 200 = ipg-sandbox / documented success set; 100 accepted per production IDPay docs (D9).
    const status = data.status;
    const isSuccessful = status === 200 || status === 100;
    return {
      isSuccessful,
      refundId: data.track_id !== undefined && data.track_id !== null ? String(data.track_id) : undefined,
      errorReason: isSuccessful
        ? undefined
        : data.error_message || `Refund failed (status ${status})`,
    };
  }
}
