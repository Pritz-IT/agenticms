import type { StoredCredential } from "./config.js";

export class CliHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CliHttpError";
  }
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
    throw new CliHttpError(response.status, text || response.statusText);
  }

  return (text ? JSON.parse(text) : undefined) as T;
}
