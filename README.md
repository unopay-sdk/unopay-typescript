# UnoPay 💳

A strictly-typed, unified TypeScript SDK for managing payments across Iranian Internet Payment Gateways (IPGs).

## Features
- **Unified Interface**: Route and handle payments across providers using a single API.
- **Type-Safe**: Autocompletes configured gateway keys; zero `any` types.
- **Universal & Edge-Ready**: Built on standard `fetch` API. Compatible with Node.js 18+, Bun, Deno, Cloudflare Workers, and Vercel Edge.
- **Automatic Currency Normalization**: Accepts `IRR`, `IRT`, or `TOMAN` and normalizes transparently.
- **Standardized Error Hierarchy**: Catches and maps provider-specific errors and timeouts to typed exceptions (`GatewayNetworkError`, `PaymentValidationError`, `GatewayProviderError`).
- **Framework-Agnostic Callbacks**: Verifies callbacks directly from Express, Fastify, Next.js, Hono, or native `Request`.

---

## Installation

```bash
npm install unopay
# or
pnpm add unopay
# or
yarn add unopay
```

---

## Quick Start

### 1. Initialize Client

```typescript
import { UnoPay, ZarinpalAdapter } from 'unopay';

const unopay = new UnoPay({
  zarinpal: new ZarinpalAdapter({
    merchantId: process.env.ZARINPAL_MERCHANT_ID!,
    sandbox: process.env.NODE_ENV !== 'production',
  }),
});
```

### 2. Request Payment

```typescript
const payment = await unopay.createPayment('zarinpal', {
  amount: 50000,
  currency: 'IRT', // Automatically converted to Rials for providers that require IRR
  callbackUrl: 'https://yoursite.com/api/payment/callback',
  metadata: {
    description: 'Order #1024',
    mobile: '09120000000',
  },
});

// Redirect the user
console.log('Redirect user to:', payment.redirectUrl);
console.log('Authority/Token:', payment.providerToken);
```

### 3. Handle & Verify Callback

Pass the incoming query params and request body from any framework:

```typescript
// Express / Next.js / Fastify / Hono handler
app.get('/api/payment/callback', async (req, res) => {
  try {
    const result = await unopay.verifyCallback('zarinpal', {
      method: req.method,
      query: req.query,
      body: req.body,
    });

    if (result.isSuccessful) {
      console.log('Payment verified! Reference ID:', result.transactionId);
      return res.send(`Payment successful! Ref ID: ${result.transactionId}`);
    } else {
      console.error('Payment rejected:', result.errorReason);
      return res.status(400).send(`Payment failed: ${result.errorReason}`);
    }
  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).send('Verification failed');
  }
});
```

---

## Testing against ipg-sandbox

Every adapter points at any sandbox host via `baseUrl` — the ipg-sandbox stack
(`../../ipg-sandbox/`, local compose or its cloud host) emulates Zarinpal, IDPay and
Behpardakht (Mellat) so the full lifecycle runs without a real gateway.

```typescript
const base = process.env.UNOPAY_SANDBOX_URL!;           // e.g. http://localhost:8080
const unopay = new UnoPay({
  zarinpal: new ZarinpalAdapter({
    merchantId: 'sandbox-merchant',
    baseUrl: `${base}/zarinpal/pg`,
    refundUrl: `${base}/zarinpal/payment/refund`,
  }),
  idpay: new IdpayAdapter({ apiKey: 'sandbox-key', baseUrl: `${base}/idpay/v1.1` }),
  behpardakht: new BehpardakhtAdapter({
    terminalId: '123456', username: 'sandbox', password: 'sandbox',
    baseUrl: `${base}/behpardakht`,
  }),
});
```

- **Cloud host**: pass the `ipg_key_…` it issues as `sandboxApiKey` on any adapter — sent as
  `Authorization: Bearer`, it scopes requests to that key's project.
- **Force an outcome**: `scenario: 'approve' | 'decline' | 'timeout' | 'refund' | 'pending_settle' | 'verify_fail'`
  sends `X-Sandbox-Scenario` on initiate. Without it the project's `default_scenario` decides.
- **Refunds**: `await unopay.refund('zarinpal', { transactionId })` — available on all three
  gateways.

Run the integration suite (skip/strict/unreachable semantics, gateway preflight and the
18-cell scenario matrix are all handled for you):

```bash
UNOPAY_SANDBOX_URL=http://localhost:8080 pnpm test   # unit + integration
pnpm test:integration                                # integration only, strict mode
```

Full setup and validation guide: [`specs/002-ipg-sandbox-integration/quickstart.md`](specs/002-ipg-sandbox-integration/quickstart.md).

---

## Observability & Structured Logging

Optionally inject a logger (Pino, Winston, or `console`) to trace lifecycle events:

```typescript
const unopay = new UnoPay(
  {
    zarinpal: new ZarinpalAdapter({ merchantId: 'xxx' }),
  },
  {
    info: (msg, ctx) => console.log(`[INFO] ${msg}`, ctx),
    error: (msg, ctx) => console.error(`[ERROR] ${msg}`, ctx),
    warn: (msg, ctx) => console.warn(`[WARN] ${msg}`, ctx),
    debug: (msg, ctx) => console.debug(`[DEBUG] ${msg}`, ctx),
  }
);
```

Lifecycle log events:
- `payment_started`
- `provider_request_sent`
- `payment_failed`
- `verification_completed`
- `verification_failed`
- `refund_started`
- `refund_completed`
- `refund_failed`

---

## Error Handling

All gateway and network errors inherit from `PaymentError`:

```typescript
import {
  PaymentError,
  PaymentValidationError,
  GatewayNetworkError,
  GatewayProviderError,
} from 'unopay';

try {
  await unopay.createPayment('zarinpal', request);
} catch (err) {
  if (err instanceof PaymentValidationError) {
    // Missing required parameters (e.g. invalid merchant ID, amount <= 0)
  } else if (err instanceof GatewayNetworkError) {
    // Connection drop or timeout
  } else if (err instanceof GatewayProviderError) {
    // Rejected by bank / IPG with raw error in err.cause
  } else if (err instanceof PaymentError) {
    // General SDK error
  }
}
```

---

## Supported Gateways

| Gateway | Status | Adapter |
|---|---|---|
| **ZarinPal (زرین‌پال)** | ✅ Supported | `ZarinpalAdapter` |
| **IDPay (آیدی‌پی)** | 🚧 Planned | `IdpayAdapter` |
| **Behpardakht Mellat (به‌پرداخت)** | 🚧 Planned | `BehpardakhtAdapter` |
| **Saman SEP (سامان)** | 🚧 Planned | `SamanAdapter` |

---

## License

ISC © [UnoPay Contributors](LICENSE)
