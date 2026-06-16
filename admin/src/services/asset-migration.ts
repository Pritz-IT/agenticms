import type { Asset, PrismaClient } from "@prisma/client";
import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, normalize, posix } from "node:path";

const ASSET_PREFIX = "/assets/";

export interface AssetMigrationSite {
  id: string;
  key: string;
}

export interface AssetMigrationResult {
  scanned: number;
  migrated: number;
  filesCopied: number;
  filesAlreadyPresent: number;
  missingFiles: string[];
  contentUpdated: number;
  layoutsUpdated: number;
}

interface AssetMove {
  asset: Asset;
  from: string;
  to: string;
  relativePath: string;
}

function isSafeRelativePath(value: string): boolean {
  const normalized = normalize(value);
  return !!value && !normalized.startsWith("..") && !posix.isAbsolute(value) && !value.split(/[\\/]/).some((part) => part === "..");
}

function legacyMoveForAsset(asset: Asset, siteKey: string): AssetMove | null {
  if (!asset.filePath.startsWith(ASSET_PREFIX)) return null;
  if (asset.filePath.startsWith(`${ASSET_PREFIX}${siteKey}/`)) return null;

  const relativePath = asset.filePath.slice(ASSET_PREFIX.length);
  if (!isSafeRelativePath(relativePath)) return null;

  return {
    asset,
    from: asset.filePath,
    to: `${ASSET_PREFIX}${siteKey}/${relativePath}`,
    relativePath,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

function rewriteAssetReferences(value: unknown, replacements: Map<string, string>): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const replacement = replacements.get(value);
    return replacement ? { value: replacement, changed: true } : { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = rewriteAssetReferences(item, replacements);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteAssetReferences(item, replacements);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }

  return { value, changed: false };
}

export async function migrateLegacyAssetsForSite(
  prisma: PrismaClient,
  assetsDir: string,
  site: AssetMigrationSite
): Promise<AssetMigrationResult> {
  const assets = await prisma.asset.findMany({
    where: { siteId: site.id },
    orderBy: { uploadedAt: "asc" },
  });

  const moves = assets
    .map((asset) => legacyMoveForAsset(asset, site.key))
    .filter((move): move is AssetMove => move !== null);

  const replacements = new Map<string, string>();
  let filesCopied = 0;
  let filesAlreadyPresent = 0;
  const missingFiles: string[] = [];

  for (const move of moves) {
    const source = join(assetsDir, move.relativePath);
    const target = join(assetsDir, site.key, move.relativePath);
    const targetExists = await exists(target);

    if (targetExists) {
      filesAlreadyPresent += 1;
    } else if (await exists(source)) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      filesCopied += 1;
    } else {
      missingFiles.push(move.from);
      continue;
    }

    replacements.set(move.from, move.to);
    await prisma.asset.update({
      where: { id: move.asset.id },
      data: { filePath: move.to },
    });
  }

  let contentUpdated = 0;
  let layoutsUpdated = 0;

  if (replacements.size > 0) {
    for (const [from, to] of replacements) {
      const result = await prisma.content.updateMany({
        where: {
          value: from,
          page: { siteId: site.id },
        },
        data: { value: to },
      });
      contentUpdated += result.count;
    }

    const layouts = await prisma.layout.findMany({
      where: { siteId: site.id },
      select: { id: true, detectedKeys: true },
    });

    for (const layout of layouts) {
      const result = rewriteAssetReferences(layout.detectedKeys, replacements);
      if (!result.changed) continue;

      await prisma.layout.update({
        where: { id: layout.id },
        data: { detectedKeys: result.value as any },
      });
      layoutsUpdated += 1;
    }
  }

  return {
    scanned: moves.length,
    migrated: replacements.size,
    filesCopied,
    filesAlreadyPresent,
    missingFiles,
    contentUpdated,
    layoutsUpdated,
  };
}
