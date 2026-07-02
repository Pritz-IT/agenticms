import { api } from "./client";

export function fetchForms(siteKey: string): Promise<{ forms: string[] }> {
  return api<{ forms: string[] }>(`/api/sites/${siteKey}/forms`);
}

export function addForm(siteKey: string, form: string): Promise<{ forms: string[] }> {
  return api<{ forms: string[] }>(`/api/sites/${siteKey}/forms`, {
    method: "POST",
    body: JSON.stringify({ form }),
  });
}

export function removeForm(siteKey: string, slug: string): Promise<{ forms: string[] }> {
  return api<{ forms: string[] }>(`/api/sites/${siteKey}/forms/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
}
