import { readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import chokidar from "chokidar";
import type { PrismaClient } from "@prisma/client";
import { log } from "../logging.js";

// Same MIME table as scripts/sync-assets.ts — keep them in sync.
export const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// Extensions that must NEVER be accepted via an interactive editor upload even
// though they are valid asset types served from disk: active/executable content
// that would run same-origin if a victim navigated to it. Layout JS arrives
// through the trusted CLI sync path, not editor uploads.
const UPLOAD_DENY_EXTS = new Set([".js", ".mjs", ".json"]);

/**
 * Resolve the canonical MIME type for an editor-uploaded file from its
 * extension, or null if the extension is not an allowed upload type. The
 * client-supplied Content-Type is never trusted — it is derived here so a file
 * cannot be stored/served under a spoofed type.
 */
export function resolveUploadMime(filename: string): string | null {
  const ext = extname(filename).toLowerCase();
  if (UPLOAD_DENY_EXTS.has(ext)) return null;
  return MIME_BY_EXT[ext] ?? null;
}

const UPLOADED_BY = process.env["SYNC_UPLOADED_BY"] ?? "system";
const syncQueues = new Map<string, Promise<SyncResult>>();
const DEFAULT_SITE_KEY = "demo";

export interface SyncResult {
  scanned: number;
  created: number;
  already: number;
  skipped: number;
}

export interface SyncAssetsOptions {
  siteId: string;
  urlPrefix: string;
}

async function walk(
  dir: string,
  urlPrefix: string
): Promise<Array<{ full: string; url: string }>> {
  const out: Array<{ full: string; url: string }> = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const url = `${urlPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await walk(full, url)));
    } else if (entry.isFile()) {
      out.push({ full, url });
    }
  }
  return out;
}

/**
 * Walk `assetsDir` and ensure every supported file has an Asset row.
 * Existing rows (matched by filePath `/assets/<rel>`) are left alone;
 * unknown extensions are skipped, never deleted. Pure + idempotent.
 */
export async function syncAssets(
  prisma: PrismaClient,
  assetsDir: string,
  options: SyncAssetsOptions
): Promise<SyncResult> {
  const queueKey = `${assetsDir}:${options.siteId}:${options.urlPrefix}`;
  const previous = syncQueues.get(queueKey) ?? Promise.resolve({
    scanned: 0,
    created: 0,
    already: 0,
    skipped: 0,
  });
  const current = previous
    .catch(() => undefined)
    .then(() => syncAssetsNow(prisma, assetsDir, options));
  syncQueues.set(queueKey, current);
  try {
    return await current;
  } finally {
    if (syncQueues.get(queueKey) === current) syncQueues.delete(queueKey);
  }
}

async function syncAssetsNow(
  prisma: PrismaClient,
  assetsDir: string,
  options: SyncAssetsOptions
): Promise<SyncResult> {
  log.info({ component: "asset-watcher", assetsDir, siteId: options.siteId, urlPrefix: options.urlPrefix }, "asset sync requested");

  const existing = new Set(
    (await prisma.asset.findMany({ where: { siteId: options.siteId }, select: { filePath: true } })).map(
      (a) => a.filePath
    )
  );

  const files = await walk(assetsDir, options.urlPrefix);
  let created = 0;
  let already = 0;
  let skipped = 0;

  for (const { full, url } of files) {
    if (existing.has(url)) {
      already += 1;
      continue;
    }
    const mimeType = MIME_BY_EXT[extname(full).toLowerCase()];
    if (!mimeType) {
      skipped += 1;
      continue;
    }
    await prisma.asset.create({
      data: {
        siteId: options.siteId,
        filename: relative(assetsDir, full).replace(/^.*\//, ""),
        mimeType,
        filePath: url,
        uploadedBy: UPLOADED_BY,
      },
    });
    existing.add(url); // guard against duplicate events in one pass
    created += 1;
  }

  const result: SyncResult = { scanned: files.length, created, already, skipped };
  log.info({ component: "asset-watcher", assetsDir, siteId: options.siteId, urlPrefix: options.urlPrefix, ...result }, "asset sync done");
  return result;
}

async function defaultSyncOptions(prisma: PrismaClient): Promise<SyncAssetsOptions> {
  const site = await prisma.site.findUnique({ where: { key: DEFAULT_SITE_KEY }, select: { id: true, key: true } });
  if (!site) {
    throw new Error(`Default site not found: ${DEFAULT_SITE_KEY}`);
  }
  return { siteId: site.id, urlPrefix: `/assets/${site.key}` };
}

export async function syncDefaultSiteAssets(prisma: PrismaClient, assetsDir: string): Promise<SyncResult> {
  const site = await prisma.site.findUnique({ where: { key: DEFAULT_SITE_KEY }, select: { id: true, key: true } });
  if (!site) {
    throw new Error(`Default site not found: ${DEFAULT_SITE_KEY}`);
  }
  return syncAssets(prisma, join(assetsDir, site.key), {
    siteId: site.id,
    urlPrefix: `/assets/${site.key}`,
  });
}

/**
 * Watch `assetsDir` and auto-register dropped files (mirrors
 * startLayoutWatcher). `ignoreInitial:false` => existing files are
 * registered on startup, so this also self-heals on every deploy/restart.
 */
export function startAssetWatcher(
  prisma: PrismaClient,
  assetsDir: string,
  options?: SyncAssetsOptions
): void {
  const resync = (reason: string) => {
    (options
      ? syncAssets(prisma, assetsDir, options)
      : syncDefaultSiteAssets(prisma, assetsDir))
      .then((r) => {
        log.info({ component: "asset-watcher", reason, ...r }, "asset resync done");
      })
      .catch((err) =>
        log.error({ component: "asset-watcher", reason, err }, "asset sync failed")
      );
  };

  const watcher = chokidar.watch(`${assetsDir}/**/*`, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  watcher.on("add", (filePath) => resync(`new file ${filePath}`));
  watcher.on("change", (filePath) => resync(`changed ${filePath}`));
  watcher.on("error", (err) => {
    log.error({ component: "asset-watcher", err }, "asset watcher error");
  });

  log.info({ component: "asset-watcher", assetsDir }, "asset watcher started");
}
