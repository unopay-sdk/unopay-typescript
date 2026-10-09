/**
 * Test harness for the ipg-sandbox integration suite:
 *  - CallbackReceiver: local HTTP server that captures the REAL callback the sandbox delivers
 *    (research D5 / spec FR-011 — no synthesized callbacks)
 *  - confirmCheckout: drives the user's "confirm payment" step on the sandbox checkout
 *  - host recorder: proves every outbound request went to the sandbox (SC-002 / FR-003)
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface CapturedCallback {
  method: string;
  url: string;
  query: Record<string, string>;
}

export class CallbackReceiver {
  private captures: CapturedCallback[] = [];
  private waiters: Array<(c: CapturedCallback) => void> = [];

  private constructor(
    private readonly server: Server,
    readonly port: number
  ) {}

  static start(): Promise<CallbackReceiver> {
    return new Promise((resolve, reject) => {
      const receiver = new CallbackReceiver(
        createServer((req, res) => {
          void receiver.handle(req, res);
        }),
        0
      );
      receiver.server.once('error', reject);
      receiver.server.listen(0, '127.0.0.1', () => {
        const addr = receiver.server.address();
        if (addr === null || typeof addr === 'string') {
          reject(new Error('callback receiver failed to bind'));
          return;
        }
        (receiver as unknown as { port: number }).port = addr.port;
        resolve(receiver);
      });
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    const capture: CapturedCallback = { method: req.method ?? 'GET', url: url.pathname + url.search, query };
    this.captures.push(capture);
    const waiter = this.waiters.shift();
    if (waiter) waiter(capture);
    res.statusCode = 200;
    res.end('ok');
  }

  get callbackUrl(): string {
    return `http://127.0.0.1:${this.port}/cb`;
  }

  get host(): string {
    return `127.0.0.1:${this.port}`;
  }

  /** Most recent capture without consuming (assertions after a flow). */
  peekLast(): CapturedCallback | undefined {
    return this.captures[this.captures.length - 1];
  }

  /** Resolve with the next callback (immediately if one is already buffered). */
  waitForCallback(timeoutMs = 10000): Promise<CapturedCallback> {
    const buffered = this.captures.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no callback received within ${timeoutMs}ms`)),
        timeoutMs
      );
      this.waiters.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

export type GatewayName = 'zarinpal' | 'idpay' | 'behpardakht';

/**
 * Drive the sandbox checkout "confirm" as the user would. The 302 Location is the callback
 * URL the sandbox was given at initiate — fetching it delivers the real callback to the receiver.
 */
export async function confirmCheckout(sandboxUrl: string, gateway: GatewayName, reference: string): Promise<void> {
  const path =
    gateway === 'zarinpal'
      ? `/zarinpal/checkout/${reference}`
      : gateway === 'idpay'
        ? `/idpay/v1.1/payment/start/${reference}`
        : `/behpardakht/checkout/${reference}`;

  const res = await fetch(`${sandboxUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=confirm',
    redirect: 'follow',
  });
  if (!res.ok && res.redirected === false) {
    throw new Error(`checkout confirm failed: HTTP ${res.status} for ${path}`);
  }
}

/**
 * Records every outbound fetch URL so a test can assert nothing left the sandbox host (SC-002).
 * The callback receiver (127.0.0.1 ephemeral port) is always allowed.
 */
export class HostRecorder {
  private originalFetch: typeof fetch | null = null;
  readonly urls: string[] = [];

  install(): void {
    if (this.originalFetch) return;
    this.originalFetch = globalThis.fetch;
    const record = this.urls;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      record.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return this.originalFetch!(input, init);
    }) as typeof fetch;
  }

  /** Assert every recorded URL's host is one of `allowedHosts`. */
  assertOnly(allowedHosts: string[]): void {
    const bad = this.urls.filter((u) => {
      try {
        return !allowedHosts.includes(new URL(u).host);
      } catch {
        return true;
      }
    });
    if (bad.length > 0) {
      throw new Error(
        `FR-003 violation — traffic left the sandbox: ${bad.join(', ')} (allowed: ${allowedHosts.join(', ')})`
      );
    }
  }

  restore(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }
}
