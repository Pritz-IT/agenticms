import { genId, logError } from "../lib/log";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId: string = ""
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function refreshToken(): Promise<void> {
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });

  if (!res.ok) {
    throw new ApiError(res.status, "Session expired. Please log in again.");
  }

  const data = (await res.json()) as { accessToken: string };
  setAccessToken(data.accessToken);
}

function buildHeaders(options: RequestInit, requestId: string): Headers {
  const headers = new Headers(options.headers);
  headers.set("X-Request-Id", requestId);

  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const isFormData = options.body instanceof FormData;
  if (!isFormData && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  return headers;
}

async function fetchWithAuth(path: string, options: RequestInit, requestId: string): Promise<Response> {
  let res = await fetch(path, { ...options, headers: buildHeaders(options, requestId) });

  if (res.status !== 401) return res;

  try {
    await refreshToken();
  } catch {
    logError("api", `${options.method ?? "GET"} ${path} failed — session refresh failed`, { requestId });
    throw new ApiError(401, "Unauthorized", requestId);
  }

  res = await fetch(path, { ...options, headers: buildHeaders(options, requestId) });
  return res;
}

export async function apiRaw(path: string, options: RequestInit = {}): Promise<Response> {
  const requestId = genId();
  return fetchWithAuth(path, options, requestId);
}

export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const requestId = genId();
  const res = await fetchWithAuth(path, options, requestId);

  if (!res.ok) {
    const message = await res.clone().text().catch(() => res.statusText);
    const srvId = res.headers.get("x-request-id") ?? requestId;
    logError("api", `${options.method ?? "GET"} ${path} failed`, {
      requestId: srvId,
      status: res.status,
      bodySnippet: message.slice(0, 300),
    });
    throw new ApiError(res.status, message, srvId);
  }

  // Handle 204 No Content
  if (res.status === 204) {
    return undefined as unknown as T;
  }

  return res.json() as Promise<T>;
}
