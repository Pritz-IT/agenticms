import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { requireSite } from "../services/sites.js";

const CONTENT_TYPES = new Set(["text", "richtext", "image", "link", "page"]);
const DEFAULT_SITE_KEY = "demo";

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

interface CreatePageBody {
  path: string;
  layoutId?: string;
  sortOrder?: number;
  isPublished?: boolean;
}

interface UpdatePageBody {
  path?: string;
  layoutId?: string | null;
  sortOrder?: number;
  isPublished?: boolean;
}

async function getDefaultSiteId(app: FastifyInstance): Promise<string> {
  return (await requireSite(app, DEFAULT_SITE_KEY)).id;
}

async function findPageForSite(app: FastifyInstance, siteId: string, id: string) {
  return app.prisma.page.findFirst({
    where: { id, siteId },
  });
}

async function validateLayoutForSite(app: FastifyInstance, siteId: string, layoutId: string) {
  return app.prisma.layout.findFirst({
    where: { id: layoutId, siteId },
  });
}

async function createPageForSite(
  app: FastifyInstance,
  siteId: string,
  body: CreatePageBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const { path, layoutId, sortOrder = 0, isPublished = false } = body ?? {};

  if (!path) {
    return reply.status(400).send({ error: "path is required" });
  }

  request.log.info({ op: "page.create", siteId, path, layoutId: layoutId ?? null }, "page.create requested");

  const existing = await app.prisma.page.findUnique({ where: { siteId_path: { siteId, path } } });
  if (existing) {
    return reply.status(409).send({ error: "A page with this path already exists" });
  }

  if (layoutId) {
    const layout = await validateLayoutForSite(app, siteId, layoutId);
    if (!layout) {
      return reply.status(400).send({ error: "Layout not found for this site" });
    }
  }

  try {
    const page = await app.prisma.$transaction(async (tx) => {
      const createdPage = await tx.page.create({
        data: { siteId, path, layoutId, sortOrder, isPublished },
        include: { layout: true },
      });

      if (layoutId) {
        const layout = await tx.layout.findFirst({ where: { id: layoutId, siteId } });

        if (layout) {
          const detectedKeys = layout.detectedKeys as Record<string, { type: string; initial: string }>;
          const locales = await tx.locale.findMany({ where: { siteId } });

          for (const locale of locales) {
            for (const [key, keyDef] of Object.entries(detectedKeys)) {
              if (!CONTENT_TYPES.has(keyDef.type)) continue;

              await tx.content.upsert({
                where: { pageId_key_locale: { pageId: createdPage.id, key, locale: locale.code } },
                create: {
                  pageId: createdPage.id,
                  key,
                  locale: locale.code,
                  value: keyDef.initial ?? "",
                  type: keyDef.type as "text" | "richtext" | "image" | "link" | "page",
                },
                update: {},
              });
            }
          }
        }
      }

      return createdPage;
    });

    request.log.info({ op: "page.create", siteId, pageId: page.id }, "page.create done");
    return reply.status(201).send(page);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.status(409).send({ error: "A page with this path already exists" });
    }
    throw error;
  }
}

async function updatePageForSite(
  app: FastifyInstance,
  siteId: string,
  id: string,
  body: UpdatePageBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  request.log.info({ op: "page.update", siteId, pageId: id }, "page.update requested");
  const { path, layoutId, sortOrder, isPublished } = body ?? {};

  const existing = await findPageForSite(app, siteId, id);
  if (!existing) {
    request.log.info({ op: "page.update", siteId, pageId: id }, "page.update NO-OP — nothing matched");
    return reply.status(404).send({ error: "Page not found" });
  }

  if (layoutId) {
    const layout = await validateLayoutForSite(app, siteId, layoutId);
    if (!layout) {
      return reply.status(400).send({ error: "Layout not found for this site" });
    }
  }

  try {
    const page = await app.prisma.page.update({
      where: { id },
      data: {
        ...(path !== undefined && { path }),
        ...(layoutId !== undefined && { layoutId }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isPublished !== undefined && { isPublished }),
      },
      include: { layout: true },
    });

    request.log.info({ op: "page.update", siteId, pageId: id }, "page.update done");
    return reply.send(page);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.status(409).send({ error: "A page with this path already exists" });
    }
    throw error;
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
    const { id } = request.params;

    request.log.info({ op: "page.delete", siteId: site.id, pageId: id }, "page.delete requested");

    const existing = await findPageForSite(app, site.id, id);
    if (!existing) {
      request.log.info({ op: "page.delete", siteId: site.id, pageId: id }, "page.delete NO-OP — nothing matched");
      return reply.status(404).send({ error: "Page not found" });
    }

    await app.prisma.page.delete({ where: { id } });
    request.log.info({ op: "page.delete", siteId: site.id, pageId: id }, "page.delete done");
    return reply.send({ ok: true });
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
    const { id } = request.params;

    const siteId = await getDefaultSiteId(app);
    request.log.info({ op: "page.delete", siteId, pageId: id }, "page.delete requested");

    const existing = await findPageForSite(app, siteId, id);
    if (!existing) {
      request.log.info({ op: "page.delete", siteId, pageId: id }, "page.delete NO-OP — nothing matched");
      return reply.status(404).send({ error: "Page not found" });
    }

    await app.prisma.page.delete({ where: { id } });
    request.log.info({ op: "page.delete", siteId, pageId: id }, "page.delete done");
    return reply.send({ ok: true });
  });
}
