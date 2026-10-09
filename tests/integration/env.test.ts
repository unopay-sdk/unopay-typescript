/**
 * US3 (P3): the skip / strict / unreachable decision tree (FR-006, SC-004, research D1/D2).
 * Pure unit tests of env.ts — run with or without a sandbox present.
 */

import { describe, it, expect } from 'vitest';
import { resolveSandbox, REQUIRED_GATEWAYS } from './env.js';

function fetchOk(providers: string[]): typeof fetch {
  return (async () => ({
    ok: true,
    json: async () => ({ providers }),
  })) as unknown as typeof fetch;
}

function fetchDead(message = 'ECONNREFUSED'): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
}

describe('resolveSandbox decision tree', () => {
  it('unset URL + non-strict → skip with explicit notice', async () => {
    const d = await resolveSandbox({}, fetchOk([]));
    expect(d.kind).toBe('skip');
    if (d.kind === 'skip') {
      expect(d.notice).toContain('sandbox not configured');
      expect(d.notice).toContain('UNOPAY_SANDBOX_URL');
    }
  });

  it('unset URL + UNOPAY_SANDBOX_STRICT → fail', async () => {
    const d = await resolveSandbox({ UNOPAY_SANDBOX_STRICT: '1' }, fetchDead());
    expect(d.kind).toBe('fail');
    if (d.kind === 'fail') expect(d.reason).toContain('UNOPAY_SANDBOX_STRICT');
  });

  it('configured but unreachable → fail with connection detail (always, never skip)', async () => {
    const d = await resolveSandbox({ UNOPAY_SANDBOX_URL: 'http://localhost:9999' }, fetchDead('connect ECONNREFUSED'));
    expect(d.kind).toBe('fail');
    if (d.kind === 'fail') {
      expect(d.reason).toContain('http://localhost:9999');
      expect(d.reason).toContain('ECONNREFUSED');
    }
  });

  it('reachable but a gateway is not offered → fail with the enable-psql hint', async () => {
    const d = await resolveSandbox({ UNOPAY_SANDBOX_URL: 'http://localhost:8080' }, fetchOk(['zarinpal']));
    expect(d.kind).toBe('fail');
    if (d.kind === 'fail') {
      expect(d.reason).toContain('idpay');
      expect(d.reason).toContain('behpardakht');
      expect(d.reason).toContain('UPDATE adapter_configs SET enabled=true');
    }
  });

  it('reachable with all three gateways → ready with compose-seed defaults', async () => {
    const d = await resolveSandbox(
      { UNOPAY_SANDBOX_URL: 'http://localhost:8080/' },
      fetchOk([...REQUIRED_GATEWAYS])
    );
    expect(d.kind).toBe('ready');
    if (d.kind === 'ready') {
      expect(d.config.url).toBe('http://localhost:8080'); // trailing slash trimmed
      expect(d.config.sandboxApiKey).toBeUndefined();
      expect(d.config.idpayApiKey).toBe('sandbox-key');
      expect(d.config.merchantId).toBe('sandbox-merchant');
      expect(d.config.terminalId).toBe('123456');
    }
  });

  it('credential env overrides win over defaults', async () => {
    const d = await resolveSandbox(
      {
        UNOPAY_SANDBOX_URL: 'http://host',
        UNOPAY_SANDBOX_API_KEY: 'ipg_key_cloud',
        UNOPAY_SANDBOX_IDPAY_API_KEY: 'idpay-cloud-key',
        UNOPAY_SANDBOX_MERCHANT_ID: 'cloud-merchant',
      },
      fetchOk([...REQUIRED_GATEWAYS])
    );
    expect(d.kind).toBe('ready');
    if (d.kind === 'ready') {
      expect(d.config.sandboxApiKey).toBe('ipg_key_cloud');
      expect(d.config.idpayApiKey).toBe('idpay-cloud-key');
      expect(d.config.merchantId).toBe('cloud-merchant');
    }
  });

  it('preflight HTTP error → fail', async () => {
    const d = await resolveSandbox({ UNOPAY_SANDBOX_URL: 'http://x' }, (async () => ({
      ok: false,
      status: 503,
    })) as unknown as typeof fetch);
    expect(d.kind).toBe('fail');
    if (d.kind === 'fail') expect(d.reason).toContain('HTTP 503');
  });
});
