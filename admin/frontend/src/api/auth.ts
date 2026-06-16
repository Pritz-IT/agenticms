import { api, setAccessToken } from "./client";
import type { LoginResponse } from "./types";

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await api<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function logout(): Promise<void> {
  await api<void>("/api/auth/logout", { method: "POST" });
  setAccessToken("");
}

export async function refresh(): Promise<LoginResponse> {
  return api<LoginResponse>("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
}
