import type { FastifyInstance } from "fastify";
import { requireSite } from "../services/sites.js";
import { sanitizeContentValue } from "../lib/content-sanitize.js";

const DEFAULT_SITE_KEY = "demo";
const CONTENT_TYPES = new Set(["text", "richtext", "image", "link", "page"]);

interface CreateContentBody {
  pageId: string;
  key: string;
  locale: string;
  value: string;
  type: "text" | "richtext" | "image" | "link" | "page";
}

interface UpdateContentBody {
  value: string;
}

interface UpsertPageContentBody {
  key: string;
  locale: string;
  value: string;
  type?: "text" | "richtext" | "image" | "link" | "page";
}

async function getDefaultSiteId(app: FastifyInstance): Promise<string> {
  return (await requireSite(app, DEFAULT_SITE_KEY)).id;
}

async function findPageForSite(app: FastifyInstance, siteId: string, pageId: string) {
  return app.prisma.page.findFirst({
    where: { id: pageId, siteId },
  });
}

async function findContentForSite(app: FastifyInstance, siteId: string, id: string) {
  return app.prisma.content.findFirst({
    where: { id, page: { siteId } },
  });
}

export async function registerSiteContentRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: { siteKey: string; pageId: string }; Querystring: { locale?: string } }>(
    "/:siteKey/content/:pageId",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const page = await findPageForSite(app, site.id, request.params.pageId);
      if (!page) {
        return reply.status(404).send({ error: "Page not found" });
      }

      const contents = await app.prisma.content.findMany({
        where: {
          pageId: page.id,
          ...(request.query.locale && { locale: request.query.locale }),
        },
        orderBy: { key: "asc" },
      });

      return reply.send(contents);
    }
  );

  app.put<{ Params: { siteKey: string; pageId: string }; Body: UpsertPageContentBody }>(
    "/:siteKey/content/:pageId",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const page = await findPageForSite(app, site.id, request.params.pageId);
      if (!page) {
        return reply.status(404).send({ error: "Page not found" });
      }

      const { key, locale, value, type = "text" } = request.body ?? {};
      if (!key || !locale || value === undefined || !type) {
        return reply.status(400).send({ error: "key, locale, value, and type are required" });
      }
      if (!CONTENT_TYPES.has(type)) {
        return reply.status(400).send({ error: "Unsupported content type" });
      }

      const safeValue = sanitizeContentValue(value, type);
      const content = await app.prisma.content.upsert({
        where: { pageId_key_locale: { pageId: page.id, key, locale } },
        create: { pageId: page.id, key, locale, value: safeValue, type },
        update: { value: safeValue, type },
      });

      return reply.send(content);
    }
  );

  app.delete<{ Params: { siteKey: string; id: string } }>(
    "/:siteKey/content/entries/:id",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const existing = await findContentForSite(app, site.id, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: "Content entry not found" });
      }

      await app.prisma.content.delete({ where: { id: request.params.id } });
      return reply.send({ ok: true });
    }
  );

  app.put<{ Params: { siteKey: string; id: string }; Body: UpdateContentBody }>(
    "/:siteKey/content/entries/:id",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const existing = await findContentForSite(app, site.id, request.params.id);
      if (!existing) {
        return reply.status(404).send({ error: "Content entry not found" });
      }

      const { value } = request.body ?? {};
      if (value === undefined) {
        return reply.status(400).send({ error: "value is required" });
      }

      const content = await app.prisma.content.update({
        where: { id: request.params.id },
        data: { value: sanitizeContentValue(value, existing.type) },
      });
      return reply.send(content);
    }
  );

  app.delete<{ Params: { siteKey: string; pageId: string } }>(
    "/:siteKey/content/:pageId/orphaned",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const page = await app.prisma.page.findFirst({
        where: { id: request.params.pageId, siteId: site.id },
        include: { layout: true },
      });
      if (!page) {
        return reply.status(404).send({ error: "Page not found" });
      }

      const detectedKeys = (page.layout?.detectedKeys as Record<string, unknown>) ?? {};
      const validKeys = new Set(Object.keys(detectedKeys));
      const allEntries = await app.prisma.content.findMany({
        where: { pageId: page.id },
        select: { id: true, key: true },
      });
      const orphanedIds = allEntries
        .filter((entry) => !validKeys.has(entry.key))
        .map((entry) => entry.id);

      if (orphanedIds.length === 0) {
        return reply.send({ deleted: 0 });
      }

      const result = await app.prisma.content.deleteMany({
        where: { id: { in: orphanedIds } },
      });
      return reply.send({ deleted: result.count });
    }
  );

  app.delete<{ Params: { siteKey: string; pageId: string; locale: string } }>(
    "/:siteKey/content/:pageId/reset/:locale",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const page = await findPageForSite(app, site.id, request.params.pageId);
      if (!page) {
        return reply.status(404).send({ error: "Page not found" });
      }

      const result = await app.prisma.content.deleteMany({
        where: { pageId: page.id, locale: request.params.locale },
      });
      return reply.send({ deleted: result.count });
    }
  );
}

export default async function contentRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET / — return content entries filtered by optional pageId and locale, ordered by key asc
  app.get<{ Querystring: { pageId?: string; locale?: string } }>("/", async (request, reply) => {
    const { pageId, locale } = request.query;
    const siteId = await getDefaultSiteId(app);

    if (pageId) {
      const page = await findPageForSite(app, siteId, pageId);
      if (!page) {
        return reply.status(404).send({ error: "Page not found" });
      }
    }

    const contents = await app.prisma.content.findMany({
      where: {
        ...(pageId && { pageId }),
        ...(locale && { locale }),
        page: { siteId },
      },
      orderBy: { key: "asc" },
    });

    return reply.send(contents);
  });

  // POST / — create content entry; 409 on duplicate (pageId, key, locale)
  app.post<{ Body: CreateContentBody }>("/", async (request, reply) => {
    const { pageId, key, locale, value, type } = request.body ?? {};

    if (!pageId || !key || !locale || value === undefined || !type) {
      return reply.status(400).send({ error: "pageId, key, locale, value, and type are required" });
    }

    request.log.info({ op: "content.write", pageId, key, locale, type }, "content.write requested");

    const siteId = await getDefaultSiteId(app);
    const page = await findPageForSite(app, siteId, pageId);
    if (!page) {
      return reply.status(404).send({ error: "Page not found" });
    }

    const existing = await app.prisma.content.findUnique({
      where: { pageId_key_locale: { pageId, key, locale } },
    });

    if (existing) {
      return reply.status(409).send({ error: "Content entry already exists for this page, key, and locale" });
    }

    const content = await app.prisma.content.create({
      data: { pageId, key, locale, value: sanitizeContentValue(value, type), type },
    });

    request.log.info({ op: "content.write", contentId: content.id, pageId, key, locale }, "content.write done");
    return reply.status(201).send(content);
  });

  // PUT /:id — update content value
  app.put<{ Params: { id: string }; Body: UpdateContentBody }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const { value } = request.body ?? {};

    if (value === undefined) {
      return reply.status(400).send({ error: "value is required" });
    }

    request.log.info({ op: "content.write", contentId: id }, "content.write requested");

    const siteId = await getDefaultSiteId(app);
    const existing = await findContentForSite(app, siteId, id);
    if (!existing) {
      request.log.info({ op: "content.write", contentId: id }, "content.write NO-OP — nothing matched");
      return reply.status(404).send({ error: "Content entry not found" });
    }

    const content = await app.prisma.content.update({
      where: { id },
      data: { value: sanitizeContentValue(value, existing.type) },
    });

    request.log.info({ op: "content.write", contentId: id }, "content.write done");
    return reply.send(content);
  });

  // DELETE /orphaned/:pageId — delete all content entries whose key is not in the layout's detectedKeys
  app.delete<{ Params: { pageId: string } }>("/orphaned/:pageId", async (request, reply) => {
    const { pageId } = request.params;

    request.log.info({ op: "content.delete", pageId, variant: "orphaned" }, "content.delete requested");

    const siteId = await getDefaultSiteId(app);
    const page = await app.prisma.page.findFirst({
      where: { id: pageId, siteId },
      include: { layout: true },
    });

    if (!page) {
      request.log.info({ op: "content.delete", pageId, variant: "orphaned" }, "content.delete NO-OP — nothing matched");
      return reply.status(404).send({ error: "Page not found" });
    }

    const detectedKeys = (page.layout?.detectedKeys as Record<string, unknown>) ?? {};
    const validKeys = new Set(Object.keys(detectedKeys));

    const allEntries = await app.prisma.content.findMany({
      where: { pageId },
      select: { id: true, key: true },
    });

    const orphanedIds = allEntries
      .filter((e) => !validKeys.has(e.key))
      .map((e) => e.id);

    if (orphanedIds.length === 0) {
      request.log.info({ op: "content.delete", pageId, variant: "orphaned", deleted: 0 }, "content.delete NO-OP — nothing matched");
      return reply.send({ deleted: 0 });
    }

    const result = await app.prisma.content.deleteMany({
      where: { id: { in: orphanedIds } },
    });

    request.log.info({ op: "content.delete", pageId, variant: "orphaned", deleted: result.count }, "content.delete done");
    return reply.send({ deleted: result.count });
  });

  // DELETE /reset/:pageId/:locale — delete all content entries for a page+locale (reset to layout defaults)
  app.delete<{ Params: { pageId: string; locale: string } }>("/reset/:pageId/:locale", async (request, reply) => {
    const { pageId, locale } = request.params;

    request.log.info({ op: "content.delete", pageId, locale, variant: "reset" }, "content.delete requested");

    const siteId = await getDefaultSiteId(app);
    const page = await findPageForSite(app, siteId, pageId);
    if (!page) {
      return reply.status(404).send({ error: "Page not found" });
    }

    const result = await app.prisma.content.deleteMany({
      where: { pageId, locale },
    });

    request.log.info({ op: "content.delete", pageId, locale, variant: "reset", deleted: result.count }, "content.delete done");
    return reply.send({ deleted: result.count });
  });

  // DELETE /:id — delete content entry
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    request.log.info({ op: "content.delete", contentId: id }, "content.delete requested");

    const siteId = await getDefaultSiteId(app);
    const existing = await findContentForSite(app, siteId, id);
    if (!existing) {
      request.log.info({ op: "content.delete", contentId: id }, "content.delete NO-OP — nothing matched");
      return reply.status(404).send({ error: "Content entry not found" });
    }

    await app.prisma.content.delete({ where: { id } });
    request.log.info({ op: "content.delete", contentId: id }, "content.delete done");
    return reply.send({ ok: true });
  });
}
