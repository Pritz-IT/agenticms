import { api, getAccessToken } from "./client";
import type { Asset, AssetLibraryItem } from "./types";

export interface AssetMigrationResult {
  scanned: number;
  migrated: number;
  filesCopied: number;
  filesAlreadyPresent: number;
  missingFiles: string[];
  contentUpdated: number;
  layoutsUpdated: number;
}

export interface AssetWebpConversionResult {
  asset: Asset;
  oldFilePath: string;
  newFilePath: string;
  contentUpdated: number;
  layoutsUpdated: number;
}

export function fetchAssets(siteKey: string): Promise<Asset[]> {
  return api<Asset[]>(`/api/sites/${siteKey}/assets`);
}

export function fetchAssetLibrary(siteKey: string): Promise<AssetLibraryItem[]> {
  return api<AssetLibraryItem[]>(`/api/sites/${siteKey}/assets/library`);
}

export function copyGlobalAssetToSite(siteKey: string, globalAssetId: string): Promise<Asset> {
  return api<Asset>(`/api/sites/${siteKey}/global-assets/${globalAssetId}/copy`, { method: "POST" });
}

export async function uploadAsset(siteKey: string, file: File): Promise<Asset> {
  const formData = new FormData();
  formData.append("file", file);

  const headers: HeadersInit = {};
  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/api/sites/${siteKey}/assets`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`Upload failed (${res.status}): ${message}`);
  }

  return res.json() as Promise<Asset>;
}

export function deleteAsset(siteKey: string, id: string): Promise<void> {
  return api<void>(`/api/sites/${siteKey}/assets/${id}`, { method: "DELETE" });
}

export function migrateLegacyAssets(siteKey: string): Promise<AssetMigrationResult> {
  return api<AssetMigrationResult>(`/api/sites/${siteKey}/assets/migrate-legacy`, { method: "POST" });
}

export function convertAssetToWebp(siteKey: string, id: string): Promise<AssetWebpConversionResult> {
  return api<AssetWebpConversionResult>(`/api/sites/${siteKey}/assets/${id}/convert-webp`, { method: "POST" });
}
