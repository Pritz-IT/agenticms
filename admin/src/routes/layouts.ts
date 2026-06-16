import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { realpath, stat } from "fs/promises";
import { isAbsolute, resolve, sep } from "path";
import { performance } from "perf_hooks";
import { config } from "../config.js";
import { compileLayout } from "../services/layout-compiler.js";
import { copyLinkedGlobalTemplateToLayout } from "../services/global-layout-templates.js";
import { requireSite } from "../services/sites.js";
import type { GlobalLayoutTemplate, Layout } from "@prisma/client";

const DEFAULT_SITE_KEY = "demo";
const LEGACY_LAYOUT_PREFIX = "/layouts/";

type LayoutWithGlobalTemplate = Layout & { globalTemplate: GlobalLayoutTemplate | null };

function withGlobalTemplateMetadata(layouts: LayoutWithGlobalTemplate[]) {
  return layouts.map((layout) => ({
    ...layout,
    globalTemplate: layout.globalTemplate
      ? {
          id: layout.globalTemplate.id,
          key: layout.globalTemplate.key,
          name: layout.globalTemplate.name,
          differsFromSiteCopy: layout.globalTemplate.sourceHash !== layout.globalTemplateHash,
        }
      : null,
  }));
}

function isWithinLayoutsRoot(fullPath: string, root: string): boolean {
  return fullPath === root || fullPath.startsWith(root + sep);
}

function stripSitePrefix(filePath: string, siteKey: string): string {
  const normalized = normalizeLayoutFilePath(filePath);
  const prefix = `${siteKey}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function normalizeLayoutFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith(LEGACY_LAYOUT_PREFIX)
    ? normalized.slice(LEGACY_LAYOUT_PREFIX.length)
    : normalized;
}

async function resolveLayoutPath(filePath: string, root: string): Promise<string | null> {
  const candidates = isAbsolute(filePath)
    ? [resolve(filePath)]
    : [resolve(filePath), resolve(root, filePath)];
  const layoutsRootReal = await realpath(root).catch(() => root);

  for (const fullPath of candidates) {
    if (!isWithinLayoutsRoot(fullPath, root)) continue;
    const candidateReal = await realpath(fullPath).catch(() => null);
    if (!candidateReal) return fullPath;
    if (isWithinLayoutsRoot(candidateReal, layoutsRootReal)) return candidateReal;
  }

  return null;
}

async function sendLayoutModule(
  app: FastifyInstance,
  layout: { id: string; name: string; filePath: string },
  filePathForResolution: string,
  root: string,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const moduleCache = app.layoutModuleCache;
  const absPath = await resolveLayoutPath(filePathForResolution, root);
  if (!absPath) {
    request.log.warn({ layoutId: layout.id, filePath: layout.filePath }, "layout module rejected outside layouts dir");
    return reply.status(403).send({ error: "Layout path is outside layouts directory" });
  }

  const hit = await moduleCache.get(layout.id);
  if (hit) {
    return reply
      .header("Content-Type", "text/javascript")
      .header("Cache-Control", "no-store")
      .send(hit.code);
  }

  const started = performance.now();
  const compiled = await compileLayout(absPath);
  if (compiled.ok) {
    await moduleCache.set(layout.id, compiled.inputHash, compiled.code, compiled.inputs);
    request.log.info(
      {
        component: "layout-module",
        layoutId: layout.id,
        name: layout.name,
        inputs: compiled.inputs.length,
        ms: Math.round(performance.now() - started),
      },
      "layout module compiled"
    );
    return reply
      .header("Content-Type", "text/javascript")
      .header("Cache-Control", "no-store")
      .send(compiled.code);
  }

  const firstError = compiled.errors[0]?.text ?? "unknown compile error";
  request.log.error(
    { component: "layout-module", layoutId: layout.id, name: layout.name, absPath, error: firstError },
    "layout module compile failed"
  );

  const lastGood = await moduleCache.getLastGood(layout.id);
  if (lastGood) {
    return reply
      .header("Content-Type", "text/javascript")
      .header("Cache-Control", "no-store")
      .header("X-SF-Stale", "1")
      .send(lastGood);
  }

  return reply.status(422).send({ errors: compiled.errors });
}

async function resolveSiteLayoutModulePath(filePath: string, siteKey: string, layoutsRoot: string): Promise<{
  filePathForResolution: string;
  root: string;
}> {
  const stripped = stripSitePrefix(filePath, siteKey);
  const siteRoot = resolve(layoutsRoot, siteKey);
  const siteScopedPath = await resolveLayoutPath(stripped, siteRoot);
  if (siteScopedPath && await stat(siteScopedPath).then(() => true).catch(() => false)) {
    return { filePathForResolution: stripped, root: siteRoot };
  }

  if (siteKey !== DEFAULT_SITE_KEY) {
    return { filePathForResolution: stripped, root: siteRoot };
  }

  return { filePathForResolution: normalizeLayoutFilePath(filePath), root: layoutsRoot };
}

export async function registerSiteLayoutsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: { siteKey: string } }>("/:siteKey/layouts", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const layouts = await app.prisma.layout.findMany({
      where: { siteId: site.id },
      include: { globalTemplate: true },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send(withGlobalTemplateMetadata(layouts));
  });

  app.post<{ Params: { siteKey: string; id: string } }>(
    "/:siteKey/layouts/:id/copy-from-global",
    { preHandler: app.requireRole("admin") },
    async (request, reply) => {
      try {
        const layout = await copyLinkedGlobalTemplateToLayout(app, request.params.siteKey, request.params.id);
        return reply.send(layout);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.get<{ Params: { siteKey: string; id: string } }>("/:siteKey/layouts/:id/module.js", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const layout = await app.prisma.layout.findFirst({
      where: { id: request.params.id, siteId: site.id },
    });
    if (!layout) {
      return reply.status(404).send({ error: "Layout not found" });
    }

    const layoutsRoot = resolve(config.LAYOUTS_DIR);
    const resolved = await resolveSiteLayoutModulePath(layout.filePath, site.key, layoutsRoot);
    return sendLayoutModule(app, layout, resolved.filePathForResolution, resolved.root, reply, request);
  });

  app.get<{ Params: { siteKey: string; id: string } }>("/:siteKey/layouts/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const layout = await app.prisma.layout.findFirst({
      where: { id: request.params.id, siteId: site.id },
      include: { globalTemplate: true },
    });
    if (!layout) {
      return reply.status(404).send({ error: "Layout not found" });
    }
    return reply.send(withGlobalTemplateMetadata([layout])[0]);
  });
}

export default async function layoutsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET / — return all layouts ordered by updatedAt desc
  app.get("/", async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    const layouts = await app.prisma.layout.findMany({
      where: { siteId: site.id },
      include: { globalTemplate: true },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send(withGlobalTemplateMetadata(layouts));
  });

  // GET /:id/module.js — return the runtime-compiled preview module for a layout
  app.get<{ Params: { id: string } }>("/:id/module.js", async (request, reply) => {
    const { id } = request.params;
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    const layout = await app.prisma.layout.findFirst({ where: { id, siteId: site.id } });
    if (!layout) {
      return reply.status(404).send({ error: "Layout not found" });
    }

    const layoutsRoot = resolve(config.LAYOUTS_DIR);
    return sendLayoutModule(app, layout, normalizeLayoutFilePath(layout.filePath), layoutsRoot, reply, request);
  });

  // GET /:id — return a single layout by id
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    const layout = await app.prisma.layout.findFirst({
      where: { id, siteId: site.id },
      include: { globalTemplate: true },
    });
    if (!layout) {
      return reply.status(404).send({ error: "Layout not found" });
    }
    return reply.send(withGlobalTemplateMetadata([layout])[0]);
  });
}
