import type { FastifyInstance } from "fastify";
import type { GlobalAsset, Site } from "@prisma/client";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, join, resolve, sep } from "node:path";
import { config } from "../config.js";
import { MIME_BY_EXT, syncAssets } from "./asset-watcher.js";
import {
  validateRelativePath,
  writeBase64FileAtomic,
  type Base64SyncFile,
  type FileSyncResult,
} from "./cli-sync.js";

const GLOBAL_ASSET_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));
// Kept in step with MAX_ASSET_FILE_BYTES (cli-sync.ts): 25 MB accommodates a
// self-hosted video and stays under the 40 MB CLI route bodyLimit once base64-inflated.
const MAX_GLOBAL_ASSET_FILE_BYTES = 25 * 1024 * 1024;
const MAX_GLOBAL_ASSET_BATCH_BYTES = 25 * 1024 * 1024;

type SyncSite = Pick<Site, "id" | "key">;

interface ParsedGlobalAssetPath {
  mode: "shared" | "copyable";
  templateFolder: string | null;
}

export interface GlobalAssetSyncResult {
  files: FileSyncResult[];
  assets: Array<{
    key: string;
    mode: "shared" | "copyable";
    templateFolder: string | null;
    filePath: string;
    sourceHash: string;
    status: "registered";
  }>;
}

export interface TemplateAssetCopyResult {
  files: Array<{
    sourcePath: string;
    destinationPath: string;
    status: "copied" | "skipped";
  }>;
  assetSync: Awaited<ReturnType<typeof syncAssets>>;
}

interface TemplateAssetCopyPlan {
  globalAsset: GlobalAsset;
  destinationPath: string;
  destinationAbs: string;
  shouldCopy: boolean;
}

export class GlobalAssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlobalAssetValidationError";
  }
}

function globalAssetsRoot(): string {
  return join(config.ASSETS_DIR, "_global");
}

function parseGlobalAssetPath(relPath: string): ParsedGlobalAssetPath {
  const parts = relPath.split("/");
  if (parts[0] === "shared" && parts.length >= 2) {
    return { mode: "shared", templateFolder: null };
  }
  if (parts[0] === "templates" && parts.length >= 3) {
    return { mode: "copyable", templateFolder: parts[1] };
  }
  throw new GlobalAssetValidationError(`global asset path must start with shared/ or templates/<templateFolder>/: ${relPath}`);
}

function templateRelativePath(templateFolder: string, globalFilePath: string): string {
  const normalized = globalFilePath.replace(/\\/g, "/");
  const prefix = `/assets/_global/templates/${templateFolder}/`;
  const relPrefix = `templates/${templateFolder}/`;
  if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  if (normalized.startsWith(relPrefix)) return normalized.slice(relPrefix.length);
  throw new Error(`global file path is not copyable for template ${templateFolder}: ${globalFilePath}`);
}

function resolveWithinRoot(root: string, relPath: string): string {
  const rootAbs = resolve(root);
  const fullPath = resolve(rootAbs, relPath);
  if (fullPath !== rootAbs && !fullPath.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes target root: ${relPath}`);
  }
  return fullPath;
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    });
}

async function sha256File(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function upsertGlobalAsset(
  app: FastifyInstance,
  relPath: string,
  parsed: ParsedGlobalAssetPath,
  sourceHash: string
): Promise<GlobalAsset> {
  const mimeType = MIME_BY_EXT[extname(relPath).toLowerCase()];
  if (!mimeType) throw new GlobalAssetValidationError(`unsupported file extension for ${relPath}`);
  const filename = relPath.split("/").at(-1) ?? relPath;
  const filePath = `/assets/_global/${relPath}`;

  return app.prisma.globalAsset.upsert({
    where: { key: relPath },
    update: {
      mode: parsed.mode,
      templateFolder: parsed.templateFolder,
      filename,
      mimeType,
      filePath,
      sourceHash,
    },
    create: {
      key: relPath,
      mode: parsed.mode,
      templateFolder: parsed.templateFolder,
      filename,
      mimeType,
      filePath,
      sourceHash,
    },
  });
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function syncGlobalAssetBatch(
  app: FastifyInstance,
  files: Base64SyncFile[]
): Promise<GlobalAssetSyncResult> {
  if (!Array.isArray(files)) throw new GlobalAssetValidationError("files must be an array");

  const results: FileSyncResult[] = [];
  const assets: GlobalAssetSyncResult["assets"] = [];
  let totalBytes = 0;

  for (const file of files) {
    let relPath: string;
    try {
      relPath = validateRelativePath(file.path, GLOBAL_ASSET_EXTENSIONS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new GlobalAssetValidationError(message);
    }
    const parsed = parseGlobalAssetPath(relPath);
    if (typeof file.base64 !== "string") throw new GlobalAssetValidationError(`base64 must be a string for ${relPath}`);
    const size = Buffer.byteLength(file.base64, "base64");
    if (size > MAX_GLOBAL_ASSET_FILE_BYTES) throw new GlobalAssetValidationError(`global asset exceeds ${MAX_GLOBAL_ASSET_FILE_BYTES / (1024 * 1024)} MB limit: ${relPath}`);
    totalBytes += size;
    if (totalBytes > MAX_GLOBAL_ASSET_BATCH_BYTES) throw new GlobalAssetValidationError(`global asset batch exceeds ${MAX_GLOBAL_ASSET_BATCH_BYTES / (1024 * 1024)} MB limit`);

    const fullPath = await writeBase64FileAtomic(globalAssetsRoot(), relPath, file.base64);
    const sourceHash = await sha256File(fullPath);
    const asset = await upsertGlobalAsset(app, relPath, parsed, sourceHash);
    results.push({ path: relPath, status: "registered" });
    assets.push({
      key: asset.key,
      mode: asset.mode,
      templateFolder: asset.templateFolder,
      filePath: asset.filePath,
      sourceHash: asset.sourceHash,
      status: "registered",
    });
  }

  return { files: results, assets };
}

export async function listGlobalAssets(app: FastifyInstance): Promise<GlobalAsset[]> {
  return app.prisma.globalAsset.findMany({ orderBy: { key: "asc" } });
}

export async function listSharedGlobalAssets(app: FastifyInstance): Promise<GlobalAsset[]> {
  return app.prisma.globalAsset.findMany({
    where: { mode: "shared" },
    orderBy: { key: "asc" },
  });
}

export function copiedTemplateAssetUrl(siteKey: string, templateFolder: string, globalFilePath: string): string {
  return `/assets/${siteKey}/${templateRelativePath(templateFolder, globalFilePath)}`;
}

export function rewriteCopyableTemplateAssetUrls(
  content: string,
  siteKey: string,
  templateFolder: string
): string {
  const prefix = `/assets/_global/templates/${templateFolder}/`;
  const pattern = new RegExp(escapeRegExp(prefix) + `[^"'\\s)]+`, "g");
  return content.replace(pattern, (match) => copiedTemplateAssetUrl(siteKey, templateFolder, match));
}

export async function copyTemplateAssetsToSite(
  app: FastifyInstance,
  site: SyncSite,
  templateFolder: string
): Promise<TemplateAssetCopyResult> {
  const globalAssets = await app.prisma.globalAsset.findMany({
    where: { mode: "copyable", templateFolder },
    orderBy: { key: "asc" },
  });
  const destinationRoot = join(config.ASSETS_DIR, site.key);
  const files: TemplateAssetCopyResult["files"] = [];
  const plans: TemplateAssetCopyPlan[] = [];

  for (const globalAsset of globalAssets) {
    const destinationPath = validateRelativePath(
      templateRelativePath(templateFolder, globalAsset.key),
      GLOBAL_ASSET_EXTENSIONS
    );
    const destinationAbs = resolveWithinRoot(destinationRoot, destinationPath);
    const filePath = `/assets/${site.key}/${destinationPath}`;
    const [destinationExists, assetRows] = await Promise.all([
      fileExists(destinationAbs),
      app.prisma.asset.findMany({
        where: {
          siteId: site.id,
          filePath,
        },
        select: {
          globalAssetId: true,
        },
      }),
    ]);
    const destinationHash = destinationExists ? await sha256File(destinationAbs) : null;
    if (assetRows.some((row) => row.globalAssetId !== globalAsset.id)) {
      throw new Error(`Destination asset already exists: ${destinationPath}`);
    }
    if (!assetRows.length && destinationExists && destinationHash !== globalAsset.sourceHash) {
      throw new Error(`Destination asset file already exists without metadata: ${destinationPath}`);
    }

    plans.push({
      globalAsset,
      destinationPath,
      destinationAbs,
      shouldCopy: !destinationExists || destinationHash !== globalAsset.sourceHash,
    });
  }

  for (const plan of plans) {
    const sourcePath = join(globalAssetsRoot(), plan.globalAsset.key);
    if (plan.shouldCopy) {
      await mkdir(dirname(plan.destinationAbs), { recursive: true });
      await copyFile(sourcePath, plan.destinationAbs);
    }
    files.push({
      sourcePath: plan.globalAsset.key,
      destinationPath: plan.destinationPath,
      status: plan.shouldCopy ? "copied" : "skipped",
    });
  }

  const assetSync = await syncAssets(app.prisma, destinationRoot, {
    siteId: site.id,
    urlPrefix: `/assets/${site.key}`,
  });

  for (const plan of plans) {
    await app.prisma.asset.updateMany({
      where: {
        siteId: site.id,
        filePath: `/assets/${site.key}/${plan.destinationPath}`,
      },
      data: {
        globalAssetId: plan.globalAsset.id,
        globalAssetHash: plan.globalAsset.sourceHash,
      },
    });
  }

  return { files, assetSync };
}
