import { GatewayNetworkError, GatewayProviderError } from './errors.js';

export interface HttpOptions {
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: unknown;
  timeoutMs?: number | undefined;
  /** 'json' (default) parses the body as JSON; 'text' returns raw text (SOAP/XML). */
  responseType?: 'json' | 'text' | undefined;
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
    if (options.body !== undefined) {
      reqInit.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await fetch(url, reqInit);

    if (!res.ok) {
      const text = await res.text();
      throw new GatewayProviderError(`HTTP ${res.status} from ${url}`, text);
    }

    if (options.responseType === 'text') {
      return (await res.text()) as T;
    }
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof GatewayProviderError) throw error;
    throw new GatewayNetworkError(`Network/timeout error for ${url}`, error);
  } finally {
    clearTimeout(id);
  }
}
