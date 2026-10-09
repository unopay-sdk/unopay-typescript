import type {
  PaymentRequest,
  PaymentResult,
  VerificationResult,
  CallbackRequest,
  RefundRequest,
  RefundResult,
} from '../types.js';

export interface GatewayAdapter {
  createPayment(request: PaymentRequest): Promise<PaymentResult>;
  verifyCallback(request: CallbackRequest): Promise<VerificationResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}
