export class PaymentError extends Error {
  public code: string;
  public cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class PaymentValidationError extends PaymentError {
  constructor(message: string, cause?: unknown) {
    super(message, 'VALIDATION_ERROR', cause);
  }
}

export class GatewayNetworkError extends PaymentError {
  constructor(message: string, cause?: unknown) {
    super(message, 'NETWORK_ERROR', cause);
  }
}

export class InvalidSignatureError extends PaymentError {
  constructor(message: string, cause?: unknown) {
    super(message, 'INVALID_SIGNATURE', cause);
  }
}

export class GatewayProviderError extends PaymentError {
  constructor(message: string, cause?: unknown) {
    super(message, 'PROVIDER_ERROR', cause);
  }
}
