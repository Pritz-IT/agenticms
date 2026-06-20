import type { Asset, PrismaClient } from "@prisma/client";
import { constants } from "node:fs";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { prepareAssetUpload } from "./asset-image-conversion.js";
import { rewriteAssetReferences } from "./asset-reference-rewrite.js";

const ASSET_PREFIX = "/assets/";
const CONVERTIBLE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

export class AssetWebpConversionError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export interface ExistingAssetWebpConversionResult {
  asset: Asset;
  oldFilePath: string;
  newFilePath: string;
  contentUpdated: number;
  layoutsUpdated: number;
}

function safeAssetRelativePath(filePath: string): string | null {
  if (!filePath.startsWith(ASSET_PREFIX)) return null;
  const relativePath = filePath.slice(ASSET_PREFIX.length);
  const normalized = posix.normalize(relativePath);
  if (
    !relativePath ||
    relativePath.includes("\\") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    return null;
  }
  return normalized;
}

function webpAssetPath(filePath: string): string {
  const parsed = posix.parse(filePath);
  return `${parsed.dir}/${parsed.name}.webp`;
}

function webpFilename(filename: string): string {
  const parsed = posix.parse(filename);
  return `${parsed.name}.webp`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (_err) {
    return false;
  }
}

export async function convertExistingAssetToWebp(
  prisma: PrismaClient,
  assetsDir: string,
  site: { id: string; key: string },
  assetId: string,
): Promise<ExistingAssetWebpConversionResult> {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, siteId: site.id } });
  if (!asset) {
    throw new AssetWebpConversionError("Asset not found", 404);
  }
  if (!CONVERTIBLE_MIME_TYPES.has(asset.mimeType)) {
    throw new AssetWebpConversionError("Asset is not a PNG or JPEG image", 400);
  }

  const oldRelativePath = safeAssetRelativePath(asset.filePath);
  if (!oldRelativePath || !asset.filePath.startsWith(`${ASSET_PREFIX}${site.key}/`)) {
    throw new AssetWebpConversionError("Asset path is not site-owned", 400);
  }

  const newFilePath = webpAssetPath(asset.filePath);
  if (newFilePath === asset.filePath) {
    throw new AssetWebpConversionError("Asset is already WebP", 400);
  }

  const existingTargetAsset = await prisma.asset.findFirst({
    where: {
      siteId: site.id,
      filePath: newFilePath,
      NOT: { id: asset.id },
    },
    select: { id: true },
  });
  if (existingTargetAsset) {
    throw new AssetWebpConversionError("Converted asset path already exists", 409);
  }

  const sourcePath = join(assetsDir, oldRelativePath);
  const newRelativePath = safeAssetRelativePath(newFilePath);
  if (!newRelativePath) {
    throw new AssetWebpConversionError("Converted asset path is invalid", 400);
  }
  const targetPath = join(assetsDir, newRelativePath);

  if (!(await exists(sourcePath))) {
    throw new AssetWebpConversionError("Asset file is missing", 404);
  }
  if (await exists(targetPath)) {
    throw new AssetWebpConversionError("Converted asset file already exists", 409);
  }

  let prepared;
  try {
    prepared = await prepareAssetUpload({
      filename: asset.filename,
      mimeType: asset.mimeType,
      buffer: await readFile(sourcePath),
    });
  } catch (cause) {
    throw new AssetWebpConversionError("Invalid image upload", 415);
  }

  const replacements = new Map([[asset.filePath, newFilePath]]);
  await writeFile(targetPath, prepared.buffer);

  let result: ExistingAssetWebpConversionResult;
  try {
    result = await prisma.$transaction(async (tx) => {
      const contentUpdate = await tx.content.updateMany({
        where: {
          value: asset.filePath,
          page: { siteId: site.id },
        },
        data: { value: newFilePath },
      });

      let layoutsUpdated = 0;
      const layouts = await tx.layout.findMany({
        where: { siteId: site.id },
        select: { id: true, detectedKeys: true },
      });
      for (const layout of layouts) {
        const rewritten = rewriteAssetReferences(layout.detectedKeys, replacements);
        if (!rewritten.changed) continue;
        await tx.layout.update({
          where: { id: layout.id },
          data: { detectedKeys: rewritten.value as any },
        });
        layoutsUpdated += 1;
      }

      await tx.asset.updateMany({
        where: { siteId: site.id, filePath: asset.filePath },
        data: {
          filename: webpFilename(asset.filename),
          mimeType: "image/webp",
          filePath: newFilePath,
          globalAssetId: null,
          globalAssetHash: null,
        },
      });
      const convertedAsset = await tx.asset.findUniqueOrThrow({ where: { id: asset.id } });

      return {
        asset: convertedAsset,
        oldFilePath: asset.filePath,
        newFilePath,
        contentUpdated: contentUpdate.count,
        layoutsUpdated,
      };
    });
  } catch (err) {
    await rm(targetPath, { force: true });
    throw err;
  }

  await rm(sourcePath, { force: true });
  return result;
}
