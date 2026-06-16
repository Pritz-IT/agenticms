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

  const response = await fetch(apiUrl(adminUrl, path), { ...options, headers });
  const text = await response.text();

  if (!response.ok) {
    throw new CliHttpError(response.status, text || response.statusText);
  }

  return (text ? JSON.parse(text) : undefined) as T;
}
