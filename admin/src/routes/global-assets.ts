import type { FastifyInstance } from "fastify";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { config } from "../config.js";
import { MIME_BY_EXT, syncAssets } from "../services/asset-watcher.js";
import { validateRelativePath } from "../services/cli-sync.js";
import { listGlobalAssets } from "../services/global-assets.js";
import { requireSite, type SiteParams } from "../services/sites.js";

function resolveWithinRoot(root: string, relPath: string): string {
  const rootAbs = resolve(root);
  const fullPath = resolve(rootAbs, relPath);
  if (fullPath !== rootAbs && !fullPath.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes target root: ${relPath}`);
  }
  return fullPath;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

export default async function globalAssetsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (_request, reply) => {
    const assets = await listGlobalAssets(app);
    return reply.send(assets);
  });
}

export async function registerSiteGlobalAssetsRoutes(app: FastifyInstance) {
  app.post<{ Params: SiteParams & { id: string } }>(
    "/:siteKey/global-assets/:id/copy",
    { preHandler: app.requireRole("admin") },
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const globalAsset = await app.prisma.globalAsset.findUnique({ where: { id: request.params.id } });
      if (!globalAsset) {
        return reply.status(404).send({ error: "Global asset not found" });
      }
      if (globalAsset.mode !== "copyable" || !globalAsset.templateFolder) {
        return reply.status(400).send({ error: "Global asset is not copyable" });
      }

      let destinationPath: string;
      let sourceAbs: string;
      let destinationAbs: string;
      const destinationRoot = join(config.ASSETS_DIR, site.key);
      try {
        const targetRel = relative(`templates/${globalAsset.templateFolder}`, globalAsset.key)
          .split(/[\\/]+/)
          .join("/");
        destinationPath = validateRelativePath(targetRel, new Set(Object.keys(MIME_BY_EXT)));
        sourceAbs = resolveWithinRoot(join(config.ASSETS_DIR, "_global"), globalAsset.key);
        destinationAbs = resolveWithinRoot(destinationRoot, destinationPath);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({ error: message });
      }

      const filePath = `/assets/${site.key}/${destinationPath}`;
      const existingAsset = await app.prisma.asset.findFirst({ where: { siteId: site.id, filePath } });
      if (existingAsset && existingAsset.globalAssetId !== globalAsset.id) {
        return reply.status(409).send({ error: "Destination asset is already site-owned or linked to another global asset" });
      }

      if (!existingAsset && await fileExists(destinationAbs)) {
        return reply.status(409).send({ error: "Destination file already exists without a linked asset row" });
      }

      await mkdir(dirname(destinationAbs), { recursive: true });
      await copyFile(sourceAbs, destinationAbs);
      await syncAssets(app.prisma, destinationRoot, {
        siteId: site.id,
        urlPrefix: `/assets/${site.key}`,
      });

      if (existingAsset) {
        const asset = await app.prisma.asset.update({
          where: { id: existingAsset.id },
          data: {
            globalAssetHash: globalAsset.sourceHash,
          },
        });
        return reply.status(200).send({ ...asset, copyStatus: "refreshed" });
      }

      await app.prisma.asset.updateMany({
        where: { siteId: site.id, filePath },
        data: {
          globalAssetId: globalAsset.id,
          globalAssetHash: globalAsset.sourceHash,
        },
      });

      const asset = await app.prisma.asset.findFirstOrThrow({
        where: { siteId: site.id, filePath },
      });
      return reply.status(201).send({ ...asset, copyStatus: "copied" });
    }
  );
}
