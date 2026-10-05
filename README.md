# Unified Payment Gateway SDK

A strictly-typed, unified TypeScript SDK for managing payments across multiple Iranian Payment Gateways (IPGs).

## Features
- **Unified API**: Seamlessly switch between different gateways (Zarinpal, IDPay, etc.) with a consistent interface.
- **Strictly Typed**: No `any` types. Built with modern TypeScript.
- **Edge-Ready**: Uses standard `fetch` API, fully compatible with Node.js 18+, Cloudflare Workers, and Vercel Edge.
- **Robust Error Handling**: Gateway-specific exceptions and network issues are mapped to a standardized `PaymentError` hierarchy.
- **Observability**: Built-in lifecycle logs with support for custom loggers.

## Installation
```bash
npm install unified-payment-sdk
# or
pnpm add unified-payment-sdk
```

## Quick Start

```typescript
import { PaymentManager, ZarinpalAdapter } from 'unified-payment-sdk';

const manager = new PaymentManager({
  info: (msg, ctx) => console.log(msg, ctx),
  error: (msg, ctx) => console.error(msg, ctx),
  warn: (msg, ctx) => console.warn(msg, ctx),
  debug: (msg, ctx) => console.log(msg, ctx),
});

// Register an adapter
manager.registerAdapter(new ZarinpalAdapter(), {
  merchantId: 'your-merchant-id',
  sandbox: true,
});

// 1. Initiate Payment
const payment = await manager.createPayment('zarinpal', {
  amount: 10000,
  currency: 'IRR',
  callbackUrl: 'https://yoursite.com/payment/callback',
});

console.log('Redirect user to:', payment.redirectUrl);

// 2. Verify Payment
const verification = await manager.verifyPayment('zarinpal', {
  authority: payment.providerToken,
  amount: 10000,
});

if (verification.isSuccessful) {
  console.log('Payment verified! Ref ID:', verification.transactionId);
} else {
  console.error('Payment failed:', verification.errorReason);
}
```
