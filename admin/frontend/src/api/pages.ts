import { api } from "./client";
import type { Page } from "./types";

export function fetchPages(siteKey: string): Promise<Page[]> {
  return api<Page[]>(`/api/sites/${siteKey}/pages`);
}

export function fetchPage(siteKey: string, id: string): Promise<Page> {
  return api<Page>(`/api/sites/${siteKey}/pages/${id}`);
}

export function createPage(siteKey: string, data: Partial<Page>): Promise<Page> {
  return api<Page>(`/api/sites/${siteKey}/pages`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updatePage(siteKey: string, id: string, data: Partial<Page>): Promise<Page> {
  return api<Page>(`/api/sites/${siteKey}/pages/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deletePage(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${siteKey}/pages/${id}`, { method: "DELETE" });
}
