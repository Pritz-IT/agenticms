import { api } from "./client";
import type { Settings } from "./types";

export function fetchSettings(siteKey: string): Promise<Settings> {
  return api<Settings>(`/api/sites/${siteKey}/settings`);
}

export function updateSettings(siteKey: string, data: Partial<Settings>): Promise<Settings> {
  return api<Settings>(`/api/sites/${siteKey}/settings`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
