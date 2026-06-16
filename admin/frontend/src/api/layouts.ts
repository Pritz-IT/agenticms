import { api } from "./client";
import type { GlobalLayoutTemplate, Layout } from "./types";

export function fetchLayouts(siteKey: string): Promise<Layout[]> {
  return api<Layout[]>(`/api/sites/${siteKey}/layouts`);
}

export function fetchLayout(siteKey: string, id: string): Promise<Layout> {
  return api<Layout>(`/api/sites/${siteKey}/layouts/${id}`);
}

export function fetchGlobalLayoutTemplates(): Promise<GlobalLayoutTemplate[]> {
  return api<GlobalLayoutTemplate[]>("/api/global-layout-templates");
}

export function copyGlobalTemplateToSite(
  siteKey: string,
  templateId: string,
  destinationPath?: string
): Promise<Layout> {
  return api<Layout>(`/api/sites/${siteKey}/global-layout-templates/${templateId}/copy`, {
    method: "POST",
    body: JSON.stringify(destinationPath ? { destinationPath } : {}),
  });
}

export function copyLayoutFromGlobal(siteKey: string, layoutId: string): Promise<Layout> {
  return api<Layout>(`/api/sites/${siteKey}/layouts/${layoutId}/copy-from-global`, {
    method: "POST",
  });
}
