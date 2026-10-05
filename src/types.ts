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
