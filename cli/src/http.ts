import type { StoredCredential } from "./config.js";

export class CliHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "CliHttpError";
  }
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Supports both forms the
 * spec allows: a delay in seconds (what @fastify/rate-limit emits) or an
 * HTTP-date. Returns undefined when absent or unparseable.
 */
export function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;

  const seconds = Number(headerValue.trim());
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(headerValue);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}

function apiUrl(adminUrl: string, path: string): string {
  return new URL(path, `${adminUrl}/`).toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const retryDelaysMs = [100, 300];
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      const retryDelay = retryDelaysMs[attempt];
      if (retryDelay === undefined) break;
      await sleep(retryDelay);
    }
  }

  throw lastError;
}

export async function requestJson<T>(
  adminUrl: string,
  path: string,
  options: RequestInit = {},
  credential?: StoredCredential
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (credential) {
    headers.set("authorization", `Bearer ${credential.token}`);
  }

  const response = await fetchWithRetry(apiUrl(adminUrl, path), { ...options, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new CliHttpError(
      response.status,
      text || response.statusText,
      parseRetryAfterMs(response.headers.get("retry-after"))
    );
  }

  return (text ? JSON.parse(text) : undefined) as T;
}
