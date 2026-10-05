import type { PaymentRequest, PaymentResult, VerificationResult, CallbackRequest } from '../types.js';

export interface GatewayAdapter {
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
  verifyCallback(request: CallbackRequest): Promise<VerificationResult>;
}
