import { api } from "./client";
import type { StagingAccess } from "./types";

export function fetchStagingAccess(siteKey: string): Promise<StagingAccess[]> {
  return api<StagingAccess[]>(`/api/sites/${siteKey}/staging-access`);
}

export function createStagingAccess(siteKey: string, data: Partial<StagingAccess>): Promise<StagingAccess> {
  return api<StagingAccess>(`/api/sites/${siteKey}/staging-access`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteStagingAccess(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${siteKey}/staging-access/${id}`, { method: "DELETE" });
}
