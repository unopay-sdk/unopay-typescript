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

export interface BehpardakhtConfig {
  /** Mellat terminal id — `<terminalId>` in the SOAP envelope. */
  terminalId: string;
  /** Mellat username — `<userName>`. */
  username: string;
  /** Mellat password — `<userPassword>`. */
  password: string;
  /** Explicit endpoint base. Default: production BMI endpoint. */
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

// ponytail: hand-rolled SOAP for a fixed 3-operation surface (research D7) — payloads are
// flat leaf elements only. Upgrade path: real XML parser if payloads gain nesting/namespaces.
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function soapEnvelope(op: string, params: Record<string, string | number>): string {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(String(v))}</${k}>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n' +
    '  <soapenv:Body>\n' +
    `    <${op}>${inner}</${op}>\n` +
    '  </soapenv:Body>\n' +
    '</soapenv:Envelope>'
  );
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1] : undefined;
}

/**
 * Order id for transactions we do not get one for. Digits only (the gateway echoes it as
 * SaleOrderId, and the sandbox casts it to int for webhook payloads) and unique per call —
 * the sandbox resolves verify/refund by matching orderId with `LIMIT 1`, so a coarse
 * timestamp collides between concurrent payments and returns another transaction's answer.
 */
function nextOrderId(): string {
  return `${Date.now()}${String(Math.floor(Math.random() * 100000)).padStart(5, '0')}`;
}

export class BehpardakhtAdapter implements GatewayAdapter {
  private baseUrl: string;

  constructor(private config: BehpardakhtConfig) {
    if (!config.terminalId || !config.username || !config.password) {
      throw new PaymentValidationError('Behpardakht requires terminalId, username and password');
    }
    // Production default: BMI payment gateway — confirm exact host against BMI docs at
    // implementation time (research open item 1); sandbox runs always pass baseUrl.
    this.baseUrl = config.baseUrl ?? 'https://mabna.bmi.ir/pgw';
  }

  private async soap(op: string, params: Record<string, string | number>, withScenario = false): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/xml; charset=utf-8',
      ...(this.config.sandboxApiKey ? { Authorization: `Bearer ${this.config.sandboxApiKey}` } : {}),
      ...(withScenario && this.config.scenario ? { 'X-Sandbox-Scenario': this.config.scenario } : {}),
    };
    return request<string>(`${this.baseUrl}/MellatPaymentGateway`, {
      method: 'POST',
      headers,
      body: soapEnvelope(op, params),
      responseType: 'text',
    });
  }

  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    const amountRials = toRials(req.amount, req.currency);
    const orderId = String(req.metadata?.orderId ?? nextOrderId());

    const xml = await this.soap(
      'bpPaymentRequest',
      {
        terminalId: this.config.terminalId,
        userName: this.config.username,
        userPassword: this.config.password,
        amount: amountRials,
        orderId,
        callBackUrl: req.callbackUrl,
        additionalData: String(req.metadata?.description ?? ''),
      },
      true
    );

    const resCode = tag(xml, 'ResCode');
    const refId = tag(xml, 'RefId');
    if (resCode === '59') {
      throw new GatewayNetworkError('Behpardakht payment session expired (timeout)', xml);
    }
    if (resCode !== '0' || !refId) {
      throw new GatewayProviderError(`Behpardakht request rejected: ResCode ${resCode ?? 'unknown'}`, xml);
    }

    // Research D8: build the redirect on OUR configured origin. The sandbox hardcodes
    // localhost in RedirectUrl (breaks cloud hosts); production URLs keep their path.
    const redirectRaw = tag(xml, 'RedirectUrl') ?? '';
    const pathname = redirectRaw
      ? new URL(redirectRaw, this.baseUrl).pathname
      : `${new URL(this.baseUrl).pathname.replace(/\/$/, '')}/checkout/${refId}`;
    return {
      redirectUrl: new URL(pathname, this.baseUrl).toString(),
      transactionId: refId,
      providerToken: refId,
    };
  }

  async verifyCallback(req: CallbackRequest): Promise<VerificationResult> {
    const refId = req.query.RefId || req.body.RefId || req.query.refId || req.body.refId;
    const resCode = req.query.ResCode || req.body.ResCode;
    const amount = Number(req.query.amount || req.body.amount || 0);

    if (!refId) {
      throw new PaymentValidationError('RefId is required for Behpardakht verification');
    }

    // Non-zero checkout ResCode (11 declined / 17 cancelled) fails without calling verify.
    if (resCode !== undefined && resCode !== '' && resCode !== '0') {
      return {
        isSuccessful: false,
        transactionId: refId,
        settledAmount: amount,
        errorReason: `Checkout failed (ResCode ${resCode})`,
      };
    }

    const saleOrderId = req.query.SaleOrderId || req.body.SaleOrderId || refId;
    const saleReferenceId = req.query.SaleReferenceId || req.body.SaleReferenceId || '';
    const xml = await this.soap('bpPaymentVerification', {
      saleOrderId,
      saleReferenceId,
      orderId: saleOrderId,
    });

    const code = tag(xml, 'ResCode');
    const isSuccessful = code === '0' || code === '101';
    return {
      isSuccessful,
      transactionId: refId,
      settledAmount: amount,
      errorReason: isSuccessful ? undefined : `Verification failed (ResCode ${code ?? 'unknown'})`,
    };
  }

  async refund(req: RefundRequest): Promise<RefundResult> {
    // saleOrderId := authority — the sandbox resolves the transaction on
    // `authority == sale_order_id` (research D9).
    const xml = await this.soap('bpReverseTransaction', {
      saleOrderId: req.transactionId,
      saleReferenceId: '',
      orderId: String(req.metadata?.orderId ?? req.transactionId),
    });

    const code = tag(xml, 'ResCode');
    const isSuccessful = code === '0';
    return {
      isSuccessful,
      refundId: isSuccessful ? req.transactionId : undefined,
      errorReason: isSuccessful ? undefined : `Refund failed (ResCode ${code ?? 'unknown'})`,
    };
  }
}
