export interface PaymentRequest {
  amount: number;
  currency: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentResult {
  redirectUrl: string;
  transactionId: string;
  providerToken: string;
}

export interface CallbackRequest {
  method: string;
  query: Record<string, string>;
  body: Record<string, any>;
}

export interface VerificationResult {
  isSuccessful: boolean;
  transactionId: string;
  settledAmount: number;
  errorReason?: string | undefined;
}

export interface RefundRequest {
  /** Gateway reference for the payment to refund (authority / id / RefId). */
  transactionId: string;
  /** Amount to refund when the gateway requires it; must be positive when present. */
  amount?: number;
  /** Provider-specific passthrough fields. */
  metadata?: Record<string, unknown>;
}

export interface RefundResult {
  isSuccessful: boolean;
  refundId?: string | undefined;
  errorReason?: string | undefined;
}

/** ipg-sandbox forced payment outcome, sent as `X-Sandbox-Scenario` on initiate. */
export type SandboxScenario =
  | 'approve'
  | 'decline'
  | 'timeout'
  | 'refund'
  | 'pending_settle'
  | 'verify_fail';
