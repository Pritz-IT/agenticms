import { api } from "./client";
import type { Locale } from "./types";

export function fetchLocales(siteKey: string): Promise<Locale[]> {
  return api<Locale[]>(`/api/sites/${siteKey}/locales`);
}

export function createLocale(siteKey: string, data: Partial<Locale>): Promise<Locale> {
  return api<Locale>(`/api/sites/${siteKey}/locales`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateLocale(siteKey: string, id: string, data: Partial<Locale>): Promise<Locale> {
  return api<Locale>(`/api/sites/${siteKey}/locales/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteLocale(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${siteKey}/locales/${id}`, { method: "DELETE" });
}
