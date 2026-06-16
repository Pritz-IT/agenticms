import { api } from "./client";
import type { Site } from "./types";

export function fetchSites(): Promise<Site[]> {
  return api<Site[]>("/api/sites");
}
