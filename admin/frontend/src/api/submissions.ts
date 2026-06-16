import { api } from "./client";
import type { Submission } from "./types";

export function fetchSubmissions(siteKey: string, form?: string): Promise<Submission[]> {
  const params = form ? `?form=${encodeURIComponent(form)}` : "";
  return api<Submission[]>(`/api/sites/${encodeURIComponent(siteKey)}/submissions${params}`);
}

export function deleteSubmission(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${encodeURIComponent(siteKey)}/submissions/${encodeURIComponent(id)}`, { method: "DELETE" });
}
