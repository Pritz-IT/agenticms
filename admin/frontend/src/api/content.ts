import { api } from "./client";
import type { Content } from "./types";

export function fetchContent(siteKey: string, pageId: string, params?: { locale?: string }): Promise<Content[]> {
  const query = new URLSearchParams();
  if (params?.locale) query.set("locale", params.locale);
  const qs = query.toString();
  return api<Content[]>(`/api/sites/${siteKey}/content/${pageId}${qs ? `?${qs}` : ""}`);
}

export function createContent(siteKey: string, data: Partial<Content>): Promise<Content> {
  if (!data.pageId) throw new Error("pageId is required");
  return api<Content>(`/api/sites/${siteKey}/content/${data.pageId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function updateContent(siteKey: string, id: string, value: string): Promise<Content> {
  return api<Content>(`/api/sites/${siteKey}/content/entries/${id}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

export function deleteContent(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${siteKey}/content/entries/${id}`, { method: "DELETE" });
}

export function deleteOrphanedContent(siteKey: string, pageId: string): Promise<{ deleted: number }> {
  return api<{ deleted: number }>(`/api/sites/${siteKey}/content/${pageId}/orphaned`, { method: "DELETE" });
}

export function resetAllContent(siteKey: string, pageId: string, locale: string): Promise<{ deleted: number }> {
  return api<{ deleted: number }>(`/api/sites/${siteKey}/content/${pageId}/reset/${locale}`, { method: "DELETE" });
}
