import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import type { Asset, GlobalAsset } from "@prisma/client";
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config.js";
import { migrateLegacyAssetsForSite } from "../services/asset-migration.js";
import { resolveUploadMime } from "../services/asset-watcher.js";
import { requireSite, type SiteParams } from "../services/sites.js";

const DEFAULT_SITE_KEY = "demo";

type AssetGlobalMeta = Pick<GlobalAsset, "id" | "key" | "mode" | "filePath" | "sourceHash">;
type AssetWithGlobal = Asset & { globalAsset?: AssetGlobalMeta | null };

function assetDiskPath(filePath: string): string | null {
  if (!filePath.startsWith("/assets/")) return null;
  const relativePath = filePath.slice("/assets/".length);
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  return path.join(config.ASSETS_DIR, normalized);
}

function serializeAsset(asset: AssetWithGlobal) {
  const globalAsset = asset.globalAsset
    ? {
        id: asset.globalAsset.id,
        key: asset.globalAsset.key,
        mode: asset.globalAsset.mode,
        filePath: asset.globalAsset.filePath,
        sourceHash: asset.globalAsset.sourceHash,
      }
    : null;

  return {
    ...asset,
    globalAsset,
    differsFromGlobal: !!globalAsset && asset.globalAssetHash !== globalAsset.sourceHash,
  };
}

function hasGeneratedPrefix(asset: Asset): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i.test(path.basename(asset.filePath));
}

function preferAsset(candidate: AssetWithGlobal, current: AssetWithGlobal): AssetWithGlobal {
  const candidateIsClean = !hasGeneratedPrefix(candidate);
  const currentIsClean = !hasGeneratedPrefix(current);
  if (candidateIsClean !== currentIsClean) return candidateIsClean ? candidate : current;
  return candidate.uploadedAt > current.uploadedAt ? candidate : current;
}

async function hashAssetFile(asset: Asset): Promise<string | null> {
  const diskPath = assetDiskPath(asset.filePath);
  if (!diskPath) return null;
  try {
    return createHash("sha256").update(await fs.readFile(diskPath)).digest("hex");
  } catch (_err) {
    return null;
  }
}

async function dedupeAssets(assets: AssetWithGlobal[]): Promise<AssetWithGlobal[]> {
  const byPath = new Map<string, AssetWithGlobal>();
  for (const asset of assets) {
    const existing = byPath.get(asset.filePath);
    byPath.set(asset.filePath, existing ? preferAsset(asset, existing) : asset);
  }

  const byContent = new Map<string, AssetWithGlobal>();
  const passthrough: AssetWithGlobal[] = [];
  for (const asset of byPath.values()) {
    const hash = await hashAssetFile(asset);
    if (!hash) {
      passthrough.push(asset);
      continue;
    }

    const key = `${asset.filename}\0${hash}`;
    const existing = byContent.get(key);
    byContent.set(key, existing ? preferAsset(asset, existing) : asset);
  }

  return [...passthrough, ...byContent.values()].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
}

async function listAssetsForSite(app: FastifyInstance, siteId: string): Promise<AssetWithGlobal[]> {
  const assets = await app.prisma.asset.findMany({
    where: { siteId },
    include: {
      globalAsset: {
        select: {
          id: true,
          key: true,
          mode: true,
          filePath: true,
          sourceHash: true,
        },
      },
    },
    orderBy: { uploadedAt: "desc" },
  });
  return dedupeAssets(assets);
}

async function sendAssetsForSite(app: FastifyInstance, siteId: string, reply: FastifyReply) {
  const assets = await listAssetsForSite(app, siteId);
  return reply.send(assets.map(serializeAsset));
}

async function sendAssetLibraryForSite(app: FastifyInstance, siteId: string, reply: FastifyReply) {
  const [siteAssets, sharedGlobalAssets] = await Promise.all([
    listAssetsForSite(app, siteId),
    app.prisma.globalAsset.findMany({
      where: { mode: "shared" },
      orderBy: { key: "asc" },
    }),
  ]);

  return reply.send([
    ...siteAssets.map((asset) => ({
      ...serializeAsset(asset),
      scope: "site" as const,
      deletable: true,
    })),
    ...sharedGlobalAssets.map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      filePath: asset.filePath,
      uploadedAt: asset.registeredAt,
      uploadedBy: "global",
      scope: "global-shared" as const,
      deletable: false,
    })),
  ]);
}

async function uploadAssetForSite(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  site: { id: string; key: string }
) {
  const data = await request.file();

  if (!data) {
    return reply.status(400).send({ error: "No file uploaded" });
  }

  // Reject unsupported / active content (.js/.mjs/.json denied outright) BEFORE
  // writing to disk, and derive the stored MIME from the extension rather than
  // trusting the client — an uploaded file must never be served same-origin
  // under a spoofed type. NOTE: .svg is still allowed (common for logos); the
  // residual stored-XSS-on-direct-navigation risk for SVG/HTML is closed at the
  // nginx edge via X-Content-Type-Options: nosniff + Content-Disposition (see
  // the security headers hardening).
  const mimeType = resolveUploadMime(data.filename);
  if (!mimeType) {
    data.file.resume(); // drain the rejected upload so the request completes cleanly
    request.log.warn(
      { op: "asset.upload", filename: data.filename, siteKey: site.key },
      "asset.upload rejected — unsupported file type"
    );
    return reply.status(415).send({ error: "Unsupported file type" });
  }

  const sanitizedName = data.filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const storedName = `${uuidv4()}-${sanitizedName}`;
  const siteAssetsDir = path.join(config.ASSETS_DIR, site.key);

  await fs.mkdir(siteAssetsDir, { recursive: true });

  const destPath = path.join(siteAssetsDir, storedName);
  const writeStream = createWriteStream(destPath);
  await pipeline(data.file, writeStream);

  const asset = await app.prisma.asset.create({
    data: {
      siteId: site.id,
      filename: data.filename,
      mimeType,
      filePath: `/assets/${site.key}/${storedName}`,
      uploadedBy: request.user!.email,
    },
  });

  return reply.status(201).send(asset);
}

async function deleteAssetForSite(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply, siteId: string, id: string) {
  const asset = await app.prisma.asset.findFirst({ where: { id, siteId } });
  if (!asset) {
    return reply.status(404).send({ error: "Asset not found" });
  }

  const diskPath = assetDiskPath(asset.filePath);
  try {
    if (diskPath) await fs.unlink(diskPath);
  } catch (err) {
    request.log.debug({ op: "asset.delete", err }, "asset file already gone — record removed anyway");
  }

  await app.prisma.asset.delete({ where: { id } });
  return reply.send({ ok: true });
}

export default async function assetsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.addHook("onRequest", app.authenticate);

  app.get("/", async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return sendAssetsForSite(app, site.id, reply);
  });

  app.post("/", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return uploadAssetForSite(app, request, reply, site);
  });

  // DELETE /:id — delete asset
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return deleteAssetForSite(app, request, reply, site.id, id);
  });
}

export async function registerSiteAssetsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: SiteParams }>("/:siteKey/assets", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return sendAssetsForSite(app, site.id, reply);
  });

  app.get<{ Params: SiteParams }>("/:siteKey/assets/library", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return sendAssetLibraryForSite(app, site.id, reply);
  });

  app.post<{ Params: SiteParams }>("/:siteKey/assets/migrate-legacy", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const result = await migrateLegacyAssetsForSite(app.prisma, config.ASSETS_DIR, site);
    return reply.send(result);
  });

  app.post<{ Params: SiteParams }>("/:siteKey/assets", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return uploadAssetForSite(app, request, reply, site);
  });

  app.delete<{ Params: SiteParams & { id: string } }>("/:siteKey/assets/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return deleteAssetForSite(app, request, reply, site.id, request.params.id);
  });
}
