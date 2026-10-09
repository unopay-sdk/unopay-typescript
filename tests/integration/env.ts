/**
 * Sandbox environment gate for the integration suite (spec FR-006, research D1/D2).
 *
 * Decision tree:
 *   UNOPAY_SANDBOX_URL unset  → skip (exit 0) unless UNOPAY_SANDBOX_STRICT → fail
 *   set but unreachable       → always fail
 *   reachable, gateway off    → always fail (with enable hint)
 *   reachable + all offered   → ready
 */

export interface SandboxConfig {
  url: string;
  /** Sandbox host's project API key (`ipg_key_…`) — the key a cloud host issues. */
  sandboxApiKey?: string | undefined;
  /** IDPay merchant credential (`X-API-KEY`), seeded `sandbox-key` locally. */
  idpayApiKey: string;
  merchantId: string;
  terminalId: string;
  username: string;
  password: string;
}

export type EnvDecision =
  | { kind: 'skip'; notice: string }
  | { kind: 'fail'; reason: string }
  | { kind: 'ready'; config: SandboxConfig };

export const REQUIRED_GATEWAYS = ['zarinpal', 'idpay', 'behpardakht'] as const;

const ENABLE_HINT =
  'Enable them with: docker compose exec -T postgres psql -U postgres -d ipg_sandbox ' +
  `-c "UPDATE adapter_configs SET enabled=true WHERE provider IN ('idpay','behpardakht');"`;

function truthy(v: string | undefined): boolean {
  return v !== undefined && ['1', 'true', 'yes'].includes(v.toLowerCase());
}

export async function resolveSandbox(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<EnvDecision> {
  const url = env.UNOPAY_SANDBOX_URL?.replace(/\/+$/, '');

  if (!url) {
    if (truthy(env.UNOPAY_SANDBOX_STRICT)) {
      return {
        kind: 'fail',
        reason:
          'UNOPAY_SANDBOX_STRICT is set but UNOPAY_SANDBOX_URL is missing — strict mode requires a sandbox address',
      };
    }
    return {
      kind: 'skip',
      notice:
        '[integration] sandbox not configured: set UNOPAY_SANDBOX_URL to run integration tests — skipping',
    };
  }

  const config: SandboxConfig = {
    url,
    sandboxApiKey: env.UNOPAY_SANDBOX_API_KEY || undefined,
    idpayApiKey: env.UNOPAY_SANDBOX_IDPAY_API_KEY ?? 'sandbox-key',
    merchantId: env.UNOPAY_SANDBOX_MERCHANT_ID ?? 'sandbox-merchant',
    terminalId: env.UNOPAY_SANDBOX_TERMINAL_ID ?? '123456',
    username: env.UNOPAY_SANDBOX_USERNAME ?? 'sandbox',
    password: env.UNOPAY_SANDBOX_PASSWORD ?? 'sandbox',
  };

  let res: Response;
  try {
    res = await fetchImpl(`${url}/api/v1/providers`, {
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    return {
      kind: 'fail',
      reason: `sandbox unreachable at ${url} (${error instanceof Error ? error.message : String(error)})`,
    };
  }

  if (!res.ok) {
    return { kind: 'fail', reason: `sandbox preflight failed: HTTP ${res.status} from ${url}/api/v1/providers` };
  }

  const providers: string[] = ((await res.json()) as { providers?: string[] }).providers ?? [];
  const missing = REQUIRED_GATEWAYS.filter((g) => !providers.includes(g));
  if (missing.length > 0) {
    return {
      kind: 'fail',
      reason: `sandbox at ${url} does not offer: ${missing.join(', ')}. ${ENABLE_HINT}`,
    };
  }

  return { kind: 'ready', config };
}

let noticePrinted = false;

/**
 * Vitest swallows console output from *skipped* files, which would make the skip silent in the
 * run summary (FR-006: never silently pass). Write to the real stderr instead, once per process.
 */
function printNotice(message: string): void {
  if (noticePrinted) return;
  noticePrinted = true;
  process.stderr.write(`${message}\n`);
}

/**
 * Load the sandbox for a test file: throws on `fail-*` (non-zero exit),
 * returns null on `skip` (suite continues, notice printed), config when ready.
 */
export async function loadSandbox(): Promise<SandboxConfig | null> {
  const decision = await resolveSandbox();
  if (decision.kind === 'fail') throw new Error(`[integration] ${decision.reason}`);
  if (decision.kind === 'skip') {
    printNotice(decision.notice);
    return null;
  }
  return decision.config;
}
