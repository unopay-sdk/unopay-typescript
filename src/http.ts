import { GatewayNetworkError, GatewayProviderError } from './errors.js';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export async function request<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  try {
    const reqInit: RequestInit = {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'UnoPay-SDK/1.0',
        ...options.headers,
      },
      signal: controller.signal,
    };
    if (options.body) {
      reqInit.body = JSON.stringify(options.body);
    }

    const res = await fetch(url, reqInit);

    if (!res.ok) {
      const text = await res.text();
      throw new GatewayProviderError(`HTTP ${res.status} from ${url}`, text);
    }

    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof GatewayProviderError) throw error;
    throw new GatewayNetworkError(`Network/timeout error for ${url}`, error);
  } finally {
    clearTimeout(id);
  }
}
