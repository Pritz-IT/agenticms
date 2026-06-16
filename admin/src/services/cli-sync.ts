import type { FastifyInstance } from "fastify";
import type { Site } from "@prisma/client";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";
import { MIME_BY_EXT, syncAssets } from "./asset-watcher.js";
import { handleFile } from "./layout-watcher.js";

const TEXT_LAYOUT_EXTENSIONS = new Set([".tsx", ".ts"]);
const ASSET_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));
const MAX_ASSET_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ASSET_BATCH_BYTES = 25 * 1024 * 1024;
const DEFAULT_SITE_KEY = "demo";

export interface TextSyncFile {
  path: string;
  content: string;
}

export interface Base64SyncFile {
  path: string;
  base64: string;
}

export interface FileSyncResult {
  path: string;
  status: "written" | "registered" | "compiled" | "skipped";
}

export interface LayoutSyncResult {
  files: FileSyncResult[];
  recompiled: string[];
}

export interface AssetSyncResult {
  files: FileSyncResult[];
  assetSync: Awaited<ReturnType<typeof syncAssets>>;
}

export interface ExportedLayoutFile {
  path: string;
  content: string;
  sha256: string;
}

type SyncSite = Pick<Site, "id" | "key">;

export function validateRelativePath(input: string, allowedExtensions: Set<string>): string {
  if (typeof input !== "string") throw new Error("path must be a string");
  const normalized = input.replace(/\\/g, "/").trim();
  if (!normalized) throw new Error("path is required");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`absolute paths are not allowed: ${input}`);
  }

  const segments = normalized.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`invalid path segment in ${input}`);
    }
    if (segment.startsWith(".")) {
      throw new Error(`hidden path segments are not allowed: ${input}`);
    }
  }

  const ext = extname(normalized).toLowerCase();
  if (!allowedExtensions.has(ext)) {
    throw new Error(`unsupported file extension for ${input}`);
  }

  return normalized;
}

function pathWithinRoot(root: string, relPath: string): string {
  const rootAbs = resolve(root);
  const fullPath = resolve(rootAbs, relPath);
  if (fullPath !== rootAbs && !fullPath.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes target root: ${relPath}`);
  }
  return fullPath;
}

export async function writeTextFileAtomic(root: string, relPath: string, content: string): Promise<string> {
  const fullPath = pathWithinRoot(root, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  const tmp = join(dirname(fullPath), `.${randomUUID()}.tmp`);
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, fullPath);
  return fullPath;
}

export async function writeBase64FileAtomic(root: string, relPath: string, base64: string): Promise<string> {
  const fullPath = pathWithinRoot(root, relPath);
  const bytes = Buffer.from(base64, "base64");
  await mkdir(dirname(fullPath), { recursive: true });
  const tmp = join(dirname(fullPath), `.${randomUUID()}.tmp`);
  await writeFile(tmp, bytes);
  await rename(tmp, fullPath);
  return fullPath;
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function listLayoutFiles(root: string): Promise<string[]> {
  return (await walkFiles(root))
    .map((filePath) => relativeFromRoot(root, filePath))
    .filter((filePath) => extname(filePath).toLowerCase() === ".tsx")
    .filter((filePath) => !filePath.split("/").some((segment) => segment.startsWith(".")))
    .sort();
}

async function pruneStaleLayoutFiles(root: string, keepPaths: Set<string>): Promise<void> {
  for (const filePath of await walkFiles(root)) {
    const relPath = relativeFromRoot(root, filePath);
    const ext = extname(relPath).toLowerCase();
    if (!TEXT_LAYOUT_EXTENSIONS.has(ext)) continue;
    if (relPath.split("/").some((segment) => segment.startsWith("."))) continue;
    if (keepPaths.has(relPath)) continue;
    await rm(filePath, { force: true });
  }
}

function relativeFromRoot(root: string, filePath: string): string {
  return filePath.slice(resolve(root).length + 1).split(sep).join("/");
}

export async function exportLayoutFiles(root = config.LAYOUTS_DIR): Promise<ExportedLayoutFile[]> {
  const files = await walkFiles(root);
  const exported: ExportedLayoutFile[] = [];

  for (const filePath of files.sort()) {
    const candidatePath = relativeFromRoot(root, filePath);
    if (!TEXT_LAYOUT_EXTENSIONS.has(extname(candidatePath).toLowerCase())) continue;
    if (candidatePath.split("/").some((segment) => segment.startsWith("."))) continue;
    const relPath = validateRelativePath(candidatePath, TEXT_LAYOUT_EXTENSIONS);
    const content = await readFile(pathWithinRoot(root, relPath), "utf-8");
    exported.push({
      path: relPath,
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }

  return exported;
}

export async function syncLayoutBatch(app: FastifyInstance, files: TextSyncFile[]): Promise<LayoutSyncResult> {
  const results: FileSyncResult[] = [];
  const changedHelpers: string[] = [];
  const changedLayouts = new Set<string>();
  const syncedPaths = new Set<string>();

  for (const file of files) {
    const relPath = validateRelativePath(file.path, TEXT_LAYOUT_EXTENSIONS);
    syncedPaths.add(relPath);
    if (typeof file.content !== "string") throw new Error(`content must be a string for ${relPath}`);
    const fullPath = await writeTextFileAtomic(config.LAYOUTS_DIR, relPath, file.content);
    const ext = extname(relPath).toLowerCase();

    if (ext === ".tsx") {
      await handleFile(app.prisma, fullPath, app.layoutModuleCache, { storedFilePath: relPath });
      changedLayouts.add(relPath);
      results.push({ path: relPath, status: "compiled" });
    } else {
      changedHelpers.push(relPath);
      results.push({ path: relPath, status: "written" });
    }
  }

  if (changedLayouts.size > 0) {
    await pruneStaleLayoutFiles(config.LAYOUTS_DIR, syncedPaths);
  }

  const recompiled: string[] = [];
  if (changedHelpers.length > 0) {
    for (const relPath of await listLayoutFiles(config.LAYOUTS_DIR)) {
      if (changedLayouts.has(relPath)) continue;
      await handleFile(app.prisma, pathWithinRoot(config.LAYOUTS_DIR, relPath), app.layoutModuleCache, { storedFilePath: relPath });
      recompiled.push(relPath);
    }
  }

  return { files: results, recompiled };
}

async function requireDefaultSite(app: FastifyInstance): Promise<SyncSite> {
  const site = await app.prisma.site.findUnique({
    where: { key: DEFAULT_SITE_KEY },
    select: { id: true, key: true },
  });
  if (!site) throw new Error(`Default site not found: ${DEFAULT_SITE_KEY}`);
  return site;
}

export async function syncAssetBatch(app: FastifyInstance, site: SyncSite, files: Base64SyncFile[]): Promise<AssetSyncResult>;
export async function syncAssetBatch(app: FastifyInstance, files: Base64SyncFile[]): Promise<AssetSyncResult>;
export async function syncAssetBatch(
  app: FastifyInstance,
  siteOrFiles: SyncSite | Base64SyncFile[],
  maybeFiles?: Base64SyncFile[]
): Promise<AssetSyncResult> {
  const site = Array.isArray(siteOrFiles) ? await requireDefaultSite(app) : siteOrFiles;
  const files = Array.isArray(siteOrFiles) ? siteOrFiles : maybeFiles;
  if (!Array.isArray(files)) throw new Error("files must be an array");

  const results: FileSyncResult[] = [];
  let totalBytes = 0;
  const root = join(config.ASSETS_DIR, site.key);

  for (const file of files) {
    const relPath = validateRelativePath(file.path, ASSET_EXTENSIONS);
    if (typeof file.base64 !== "string") throw new Error(`base64 must be a string for ${relPath}`);
    const size = Buffer.byteLength(file.base64, "base64");
    if (size > MAX_ASSET_FILE_BYTES) throw new Error(`asset exceeds 10 MB limit: ${relPath}`);
    totalBytes += size;
    if (totalBytes > MAX_ASSET_BATCH_BYTES) throw new Error("asset batch exceeds 25 MB limit");

    await writeBase64FileAtomic(root, relPath, file.base64);
    results.push({ path: relPath, status: "written" });
  }

  const assetSync = await syncAssets(app.prisma, root, {
    siteId: site.id,
    urlPrefix: `/assets/${site.key}`,
  });
  return { files: results, assetSync };
}
