import { api } from "./client";
import type { Build, BuildTarget } from "./types";

export function fetchBuilds(siteKey: string): Promise<Build[]> {
  return api<Build[]>(`/api/sites/${siteKey}/builds`);
}

export function triggerBuild(siteKey: string, target: BuildTarget): Promise<Build> {
  return api<Build>(`/api/sites/${siteKey}/builds`, {
    method: "POST",
    body: JSON.stringify({ target }),
  });
}

export function rollbackBuild(siteKey: string, id: string): Promise<Build> {
  return api<Build>(`/api/sites/${siteKey}/builds/${id}/rollback`, { method: "POST" });
}
