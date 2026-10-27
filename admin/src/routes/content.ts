import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { requireSite } from "../services/sites.js";
import { sanitizeContentValue } from "../lib/content-sanitize.js";
import { BlogListFilterError, blogListDefaults, parseBlogListFilter, parsePageBlogListFilters } from "../services/blog/bloglist.js";
import { lockSiteRoutes } from "../services/blog/route-lock.js";

const DEFAULT_SITE_KEY = "demo";
const CONTENT_TYPES = new Set(["text", "richtext", "image", "link", "page", "bloglist"]);

interface CreateContentBody {
  pageId: string;
  key: string;
  locale: string;
  value: string;
  type: "text" | "richtext" | "image" | "link" | "page" | "bloglist";
}

interface UpdateContentBody {
  value: string;
}

interface UpsertPageContentBody {
  key: string;
  locale: string;
  value: string;
  type?: "text" | "richtext" | "image" | "link" | "page" | "bloglist";
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

async function saveContent(
  app: FastifyInstance, siteId: string, input: CreateContentBody,
  logger: FastifyBaseLogger, mode: "create" | "upsert" | "update", id?: string,
) {
  const { pageId, key, type, value } = input;
  const context = { op: "content.write", siteId, pageId, key, locale: input.locale, type };
  logger.info(context, "content.write requested");
  try {
    const result = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      if (!CONTENT_TYPES.has(type)) throw Object.assign(new Error("Unsupported content type"), { statusCode: 400 });
      const site = await tx.site.findUniqueOrThrow({ where: { id: siteId }, select: { defaultLocale: true } });
      const page = await tx.page.findFirst({ where: { id: pageId, siteId }, include: { layout: true } });
      if (!page) throw Object.assign(new Error("Page not found"), { statusCode: 404 });
      const locale = type === "bloglist" ? site.defaultLocale : input.locale;
      if (type === "bloglist") {
        const filter = parseBlogListFilter(value);
        const categories = await tx.blogCategory.findMany({ where: { siteId, key: { in: filter.categories } }, select: { key: true } });
        const tags = await tx.blogTag.findMany({ where: { siteId, key: { in: filter.tags } }, select: { key: true } });
        if (filter.categories.some((key) => !categories.some((category) => category.key === key))) throw new BlogListFilterError("Unknown category key for this site");
        if (filter.tags.some((key) => !tags.some((tag) => tag.key === key))) throw new BlogListFilterError("Unknown tag key for this site");
        if (filter.pageSize !== null) {
          const lists = new Map(Object.entries(blogListDefaults(page.layout?.detectedKeys)));
          const contents = await tx.content.findMany({ where: { pageId, locale: site.defaultLocale, type: "bloglist" } });
          for (const content of contents) lists.set(content.key, content.value);
          lists.set(key, value);
          parsePageBlogListFilters(page.path, Object.fromEntries(lists));
        }
      }
      const where = { pageId_key_locale: { pageId, key, locale } };
      const existing = await tx.content.findUnique({ where });
      if (mode === "create" && type !== "bloglist" && existing) throw Object.assign(new Error("Content entry already exists for this page, key, and locale"), { statusCode: 409 });
      const safeValue = sanitizeContentValue(value, type);
      if (existing?.value === safeValue && existing.type === type) return { content: existing, changed: false };
      const content = mode === "update" && type !== "bloglist"
        ? await tx.content.update({ where: { id }, data: { value: safeValue } })
        : await tx.content.upsert({ where, create: { pageId, key, locale, value: safeValue, type }, update: { value: safeValue, type } });
      return { content, changed: true };
    }, { timeout: 15000 });
    logger.info({ ...context, contentId: result.content.id, locale: result.content.locale }, result.changed ? "content.write done" : "content.write NO-OP — unchanged");
    return result.content;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) logger.warn({ ...context, err: error }, "content.write rejected");
    else logger.error({ ...context, err: error }, "content.write failed");
    logger.info(context, "content.write NO-OP — transaction rolled back");
    throw error;
  }
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

      const content = await saveContent(app, site.id, { pageId: page.id, key, locale, value, type }, request.log, "upsert");

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

      const content = await saveContent(app, site.id, { ...existing, value }, request.log, "update", existing.id);
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

    const siteId = await getDefaultSiteId(app);
    const page = await findPageForSite(app, siteId, pageId);
    if (!page) {
      return reply.status(404).send({ error: "Page not found" });
    }

    const content = await saveContent(app, siteId, { pageId, key, locale, value, type }, request.log, "create");
    return reply.status(201).send(content);
  });

  // PUT /:id — update content value
  app.put<{ Params: { id: string }; Body: UpdateContentBody }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const { value } = request.body ?? {};

    if (value === undefined) {
      return reply.status(400).send({ error: "value is required" });
    }

    const siteId = await getDefaultSiteId(app);
    const existing = await findContentForSite(app, siteId, id);
    if (!existing) {
      request.log.info({ op: "content.write", contentId: id }, "content.write NO-OP — nothing matched");
      return reply.status(404).send({ error: "Content entry not found" });
    }

    const content = await saveContent(app, siteId, { ...existing, value }, request.log, "update", id);
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
