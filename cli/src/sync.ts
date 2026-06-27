import { join } from "node:path";
import { discoverAssetFiles, discoverLayoutFiles } from "./discover.js";
import {
  loadCredential,
  resolveGlobalAssetSelection,
  resolveGlobalLayoutSelection,
  resolveSiteSelection,
} from "./config.js";
import { requestJson } from "./http.js";

interface LayoutSyncResponse {
  files: Array<{ path: string; status: string }>;
  recompiled: string[];
}

interface AssetSyncResponse {
  files: Array<{ path: string; status: string }>;
  assetSync: { scanned: number; created: number; already: number; skipped: number };
}

interface GlobalLayoutSyncResponse {
  templates: Array<{ key: string; status: string }>;
}

export interface LayoutSyncOptions {
  global?: boolean;
  template?: string;
}

export interface AssetSyncOptions {
  global?: boolean;
  template?: string;
}

// Soft batching target, not a hard per-request guarantee: a single file larger
// than this is still sent on its own (chunkAssetFiles only splits a non-empty
// batch), bounded instead by the 40 MB asset-route bodyLimit on the server.
const MAX_ASSET_SYNC_BODY_BYTES = 25 * 1024 * 1024;
const TEMPLATE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function assertGlobalTemplateKey(template: string, label: string): string {
  if (!TEMPLATE_KEY_PATTERN.test(template)) {
    throw new Error(`Invalid ${label} template key: ${template}`);
  }
  return template;
}

function assetSyncBodySize(files: Array<{ path: string; base64: string }>): number {
  return Buffer.byteLength(JSON.stringify({ files }), "utf-8");
}

function chunkAssetFiles(files: Array<{ path: string; base64: string }>): Array<Array<{ path: string; base64: string }>> {
  const chunks: Array<Array<{ path: string; base64: string }>> = [];
  let current: Array<{ path: string; base64: string }> = [];

  for (const file of files) {
    const next = [...current, file];
    if (current.length > 0 && assetSyncBodySize(next) > MAX_ASSET_SYNC_BODY_BYTES) {
      chunks.push(current);
      current = [file];
    } else {
      current = next;
    }
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export async function syncLayouts(
  adminUrlArg: string | undefined,
  projectRoot: string,
  siteArg?: string,
  options: LayoutSyncOptions = {}
): Promise<void> {
  const templateKey = options.global && options.template
    ? assertGlobalTemplateKey(options.template, "global layout")
    : undefined;
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  if (options.global) {
    const selection = await resolveGlobalLayoutSelection(projectRoot);
    const root = templateKey
      ? join(selection.globalLayoutsRoot, templateKey)
      : selection.globalLayoutsRoot;
    const files = await discoverLayoutFiles(root);
    const normalizedFiles = templateKey
      ? files.map((file) => ({ ...file, path: `${templateKey}/${file.path}` }))
      : files;
    const result = await requestJson<GlobalLayoutSyncResponse>(
      adminUrl,
      "/api/cli/sync/global-layouts",
      { method: "POST", body: JSON.stringify({ files: normalizedFiles }) },
      credential
    );
    console.log(`Global layouts synced: ${result.templates.length}`);
    return;
  }

  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const files = await discoverLayoutFiles(selection.layoutsRoot);
  const result = await requestJson<LayoutSyncResponse>(
    adminUrl,
    `/api/sites/${selection.siteKey}/cli/sync/layouts`,
    { method: "POST", body: JSON.stringify({ files }) },
    credential
  );
  console.log(`Layouts synced: ${result.files.length}`);
  if (result.recompiled.length > 0) console.log(`Recompiled: ${result.recompiled.join(", ")}`);
}

export async function syncAssets(
  adminUrlArg: string | undefined,
  projectRoot: string,
  siteArg?: string,
  options: AssetSyncOptions = {}
): Promise<void> {
  const templateKey = options.global && options.template
    ? assertGlobalTemplateKey(options.template, "global asset")
    : undefined;
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  if (options.global) {
    const selection = await resolveGlobalAssetSelection(projectRoot);
    const root = templateKey
      ? join(selection.globalAssetsRoot, "templates", templateKey)
      : selection.globalAssetsRoot;
    const discoveredFiles = await discoverAssetFiles(root);
    const files = templateKey
      ? discoveredFiles.map((file) => ({ ...file, path: `templates/${templateKey}/${file.path}` }))
      : discoveredFiles;
    const batches = chunkAssetFiles(files);
    let synced = 0;

    for (const batch of batches) {
      const result = await requestJson<AssetSyncResponse>(
        adminUrl,
        "/api/cli/sync/global-assets",
        { method: "POST", body: JSON.stringify({ files: batch }) },
        credential
      );
      synced += result.files.length;
    }

    console.log(`Global assets synced: ${synced}`);
    if (batches.length > 1) console.log(`Batches: ${batches.length}`);
    return;
  }

  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const files = await discoverAssetFiles(selection.assetsRoot);
  const batches = chunkAssetFiles(files);
  let synced = 0;
  const aggregate = { created: 0, already: 0, skipped: 0 };

  for (const batch of batches) {
    const result = await requestJson<AssetSyncResponse>(
      adminUrl,
      `/api/sites/${selection.siteKey}/cli/sync/assets`,
      { method: "POST", body: JSON.stringify({ files: batch }) },
      credential
    );
    synced += result.files.length;
    aggregate.created += result.assetSync.created;
    aggregate.already += result.assetSync.already;
    aggregate.skipped += result.assetSync.skipped;
  }

  console.log(`Assets synced: ${synced}`);
  if (batches.length > 1) console.log(`Batches: ${batches.length}`);
  console.log(`Asset registry: ${aggregate.created} created, ${aggregate.already} already, ${aggregate.skipped} skipped`);
}

export async function syncAll(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  await syncLayouts(adminUrlArg, projectRoot, siteArg);
  await syncAssets(adminUrlArg, projectRoot, siteArg);
}
