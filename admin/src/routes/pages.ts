import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { requireSite } from "../services/sites.js";
import { assertNoRouteCollisions, collectSiteRoutes, lockSiteRoutes, RouteCollisionError } from "../services/blog/route-lock.js";
import { LayoutKindError, requireLayoutOfKind } from "../services/blog/layout-kind.js";
import { sendRouteCollision } from "./route-collision.js";

const CONTENT_TYPES = new Set(["text", "richtext", "image", "link", "page", "bloglist"]);
const DEFAULT_SITE_KEY = "demo";

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class InvalidPagePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPagePathError";
  }
}

function handlePageMutationError(
  error: unknown,
  reply: FastifyReply,
  request: FastifyRequest,
  context: { op: string; siteId: string; pageId?: string }
) {
  if (error instanceof LayoutKindError || error instanceof InvalidPagePathError || error instanceof RouteCollisionError || isUniqueConstraintError(error)) {
    request.log.warn({ ...context, err: error }, `${context.op} rejected`);
    request.log.info(context, `${context.op} NO-OP — rejected`);
    if (error instanceof InvalidPagePathError || error instanceof LayoutKindError) {
      return reply.status(400).send({ error: error.message });
    }
    if (error instanceof RouteCollisionError) {
      return sendRouteCollision(reply, error);
    }
    return reply.status(409).send({ error: "A page with this path already exists" });
  }
  request.log.error({ ...context, err: error }, `${context.op} failed`);
  throw error;
}

/**
 * Normalize a page path to its canonical stored form: a single leading slash,
 * no trailing slash, and no duplicate slashes. The site root is "/".
 *
 * The website build strips the leading slash when generating routes
 * (see website/src/pages/[...slug].astro), so "about", "/about" and "/about/"
 * all resolve to the same public route. Without canonicalization they each pass
 * the exact-string uniqueness check and produce colliding routes. Existing data
 * is already stored in this form, so canonicalization is idempotent for it.
 */
export function canonicalizePagePath(rawPath: string): string {
  const stripped = rawPath.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (stripped === "") return "/";
  if (stripped.split("/").some((segment) => segment.startsWith("__"))) {
    throw new InvalidPagePathError("Page path segments starting with __ are reserved");
  }
  return "/" + stripped.replace(/\/{2,}/g, "/");
}

export interface CreatePageBody {
  path: string;
  layoutId?: string;
  sortOrder?: number;
  isPublished?: boolean;
}

export interface UpdatePageBody {
  path?: string;
  layoutId?: string | null;
  sortOrder?: number;
  isPublished?: boolean;
}

async function getDefaultSiteId(app: FastifyInstance): Promise<string> {
  return (await requireSite(app, DEFAULT_SITE_KEY)).id;
}

export async function findPageForSite(app: FastifyInstance, siteId: string, id: string) {
  return app.prisma.page.findFirst({
    where: { id, siteId },
  });
}

export async function validateLayoutForSite(app: { prisma: Prisma.TransactionClient }, siteId: string, layoutId: string) {
  return requireLayoutOfKind(app.prisma, siteId, layoutId, "page");
}

export async function createPageForSite(
  app: FastifyInstance,
  siteId: string,
  body: CreatePageBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const { path, layoutId, sortOrder = 0, isPublished = false } = body ?? {};
  request.log.info({ op: "page.create", siteId, layoutId: layoutId ?? null }, "page.create requested");

  if (typeof path !== "string" || path.trim() === "") {
    request.log.info({ op: "page.create", siteId }, "page.create NO-OP — path is required");
    return reply.status(400).send({ error: "path is required" });
  }

  try {
    const canonicalPath = canonicalizePagePath(path);

    const existing = await app.prisma.page.findUnique({ where: { siteId_path: { siteId, path: canonicalPath } } });
    if (existing) {
      request.log.info({ op: "page.create", siteId, path: canonicalPath }, "page.create NO-OP — duplicate path");
      return reply.status(409).send({ error: "A page with this path already exists" });
    }

    const page = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      const layout = layoutId != null ? await validateLayoutForSite({ prisma: tx }, siteId, layoutId) : null;
      const createdPage = await tx.page.create({
        data: { siteId, path: canonicalPath, layoutId, sortOrder, isPublished },
        include: { layout: true },
      });

      if (layout) {
        const detectedKeys = layout.detectedKeys as Record<string, { type: string; initial: string }>;
        const locales = await tx.locale.findMany({ where: { siteId } });
        const site = await tx.site.findUniqueOrThrow({ where: { id: siteId }, select: { defaultLocale: true } });

        for (const locale of locales) {
          for (const [key, keyDef] of Object.entries(detectedKeys)) {
            if (!CONTENT_TYPES.has(keyDef.type)) continue;
            if (keyDef.type === "bloglist" && locale.code !== site.defaultLocale) continue;

            await tx.content.upsert({
              where: { pageId_key_locale: { pageId: createdPage.id, key, locale: locale.code } },
              create: {
                pageId: createdPage.id,
                key,
                locale: locale.code,
                value: keyDef.initial ?? "",
                type: keyDef.type as "text" | "richtext" | "image" | "link" | "page" | "bloglist",
              },
              update: {},
            });
          }
        }
      }

      assertNoRouteCollisions(await collectSiteRoutes(tx, siteId));
      return createdPage;
    });

    request.log.info({ op: "page.create", siteId, pageId: page.id }, "page.create done");
    return reply.status(201).send(page);
  } catch (error) {
    return handlePageMutationError(error, reply, request, { op: "page.create", siteId });
  }
}

export async function updatePageForSite(
  app: FastifyInstance,
  siteId: string,
  id: string,
  body: UpdatePageBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const { path, layoutId, sortOrder, isPublished } = body ?? {};
  request.log.info({ op: "page.update", siteId, pageId: id }, "page.update requested");

  try {
    let canonicalPath: string | undefined;
    if (path !== undefined) {
      if (typeof path !== "string" || path.trim() === "") {
        request.log.info({ op: "page.update", siteId, pageId: id }, "page.update NO-OP — invalid path");
        return reply.status(400).send({ error: "path cannot be empty" });
      }
      canonicalPath = canonicalizePagePath(path);
    }

    const result = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      const existing = await tx.page.findFirst({ where: { id, siteId } });
      if (!existing) return { status: 404, error: "Page not found" };
      if (layoutId != null) await validateLayoutForSite({ prisma: tx }, siteId, layoutId);
      if (canonicalPath === "/") {
        const category = await tx.blogCategory.findFirst({ where: { siteId, pageId: id }, select: { key: true } });
        if (category) throw new InvalidPagePathError(`Page used by category ${category.key} cannot be the root page`);
      }
      const data = {
        ...(canonicalPath !== undefined && { path: canonicalPath }),
        ...(layoutId !== undefined && { layoutId }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isPublished !== undefined && { isPublished }),
      };
      const page = await tx.page.update({ where: { id }, data, include: { layout: true } });
      assertNoRouteCollisions(await collectSiteRoutes(tx, siteId));
      const changed = page.path !== existing.path || page.layoutId !== existing.layoutId
        || page.sortOrder !== existing.sortOrder || page.isPublished !== existing.isPublished;
      return { page, changed };
    });

    if (result.error) {
      request.log.info({ op: "page.update", siteId, pageId: id }, `page.update NO-OP — ${result.error}`);
      return reply.status(result.status).send({ error: result.error });
    }
    request.log.info({ op: "page.update", siteId, pageId: id }, result.changed ? "page.update done" : "page.update NO-OP — unchanged");
    return reply.send(result.page);
  } catch (error) {
    return handlePageMutationError(error, reply, request, { op: "page.update", siteId, pageId: id });
  }
}

export async function deletePageForSite(
  app: FastifyInstance,
  siteId: string,
  id: string,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const context = { op: "page.delete", siteId, pageId: id };
  request.log.info(context, "page.delete requested");
  try {
    const result = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      const existing = await tx.page.findFirst({ where: { id, siteId } });
      if (!existing) return { status: 404, body: { error: "Page not found" } };
      const category = await tx.blogCategory.findFirst({ where: { siteId, pageId: id }, select: { key: true } });
      if (category) return { status: 409, body: { error: `Page is used by category ${category.key}` } };
      await tx.page.delete({ where: { id } });
      return { status: 200, body: { ok: true } };
    });
    if (result.status === 409) request.log.warn(context, "page.delete rejected — page used by category");
    request.log.info(context, result.status === 200 ? "page.delete done" : "page.delete NO-OP — refused or nothing matched");
    return reply.status(result.status).send(result.body);
  } catch (error) {
    return handlePageMutationError(error, reply, request, context);
  }
}

export async function registerSitePagesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: { siteKey: string } }>("/:siteKey/pages", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const pages = await app.prisma.page.findMany({
      where: { siteId: site.id },
      orderBy: { sortOrder: "asc" },
      include: { layout: true },
    });
    return reply.send(pages);
  });

  app.get<{ Params: { siteKey: string; id: string } }>("/:siteKey/pages/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const page = await app.prisma.page.findFirst({
      where: { id: request.params.id, siteId: site.id },
      include: { layout: true, contents: true },
    });
    if (!page) {
      return reply.status(404).send({ error: "Page not found" });
    }
    return reply.send(page);
  });

  app.post<{ Params: { siteKey: string }; Body: CreatePageBody }>("/:siteKey/pages", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return createPageForSite(app, site.id, request.body, reply, request);
  });

  app.put<{ Params: { siteKey: string; id: string }; Body: UpdatePageBody }>("/:siteKey/pages/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return updatePageForSite(app, site.id, request.params.id, request.body, reply, request);
  });

  app.patch<{ Params: { siteKey: string; id: string }; Body: UpdatePageBody }>("/:siteKey/pages/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return updatePageForSite(app, site.id, request.params.id, request.body, reply, request);
  });

  app.delete<{ Params: { siteKey: string; id: string } }>("/:siteKey/pages/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return deletePageForSite(app, site.id, request.params.id, reply, request);
  });
}

export default async function pagesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  async function updatePageById(id: string, body: UpdatePageBody, reply: FastifyReply, request: FastifyRequest) {
    const siteId = await getDefaultSiteId(app);
    return updatePageForSite(app, siteId, id, body, reply, request);
  }

  // GET / — return all pages with layout info, ordered by sortOrder asc
  app.get("/", async (_request, reply) => {
    const siteId = await getDefaultSiteId(app);
    const pages = await app.prisma.page.findMany({
      where: { siteId },
      orderBy: { sortOrder: "asc" },
      include: { layout: true },
    });
    return reply.send(pages);
  });

  // GET /:id — single page with layout and content
  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const siteId = await getDefaultSiteId(app);
    const { id } = request.params;
    const page = await app.prisma.page.findFirst({
      where: { id, siteId },
      include: { layout: true, contents: true },
    });
    if (!page) {
      return reply.status(404).send({ error: "Page not found" });
    }
    return reply.send(page);
  });

  // POST / — create page, then pre-fill content from layout detectedKeys for all locales
  app.post<{ Body: CreatePageBody }>("/", async (request, reply) => {
    const siteId = await getDefaultSiteId(app);
    return createPageForSite(app, siteId, request.body, reply, request);
  });

  // PUT /:id — update page
  app.put<{ Params: { id: string }; Body: UpdatePageBody }>("/:id", async (request, reply) => {
    return updatePageById(request.params.id, request.body, reply, request);
  });

  // PATCH /:id — partial update page (used by the admin frontend editor)
  app.patch<{ Params: { id: string }; Body: UpdatePageBody }>("/:id", async (request, reply) => {
    return updatePageById(request.params.id, request.body, reply, request);
  });

  // DELETE /:id — delete page (content cascade-deletes via Prisma schema)
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const siteId = await getDefaultSiteId(app);
    return deletePageForSite(app, siteId, request.params.id, reply, request);
  });
}
