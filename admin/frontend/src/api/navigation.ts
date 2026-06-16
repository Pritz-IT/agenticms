import { api } from "./client";
import type { NavigationItem } from "./types";

export function fetchNavigation(siteKey: string, locale?: string): Promise<NavigationItem[]> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : "";
  return api<NavigationItem[]>(`/api/sites/${siteKey}/navigation${qs}`);
}

export function createNavigationItem(siteKey: string, data: Partial<NavigationItem>): Promise<NavigationItem> {
  return api<NavigationItem>(`/api/sites/${siteKey}/navigation`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateNavigationItem(siteKey: string, id: string, data: Partial<NavigationItem>): Promise<NavigationItem> {
  return api<NavigationItem>(`/api/sites/${siteKey}/navigation/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteNavigationItem(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${siteKey}/navigation/${id}`, { method: "DELETE" });
}
