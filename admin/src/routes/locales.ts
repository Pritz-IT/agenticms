import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Prisma } from "@prisma/client";
import { requireSite } from "../services/sites.js";
import { assertNoRouteCollisions, collectSiteRoutes, lockSiteRoutes, RouteCollisionError, type Tx } from "../services/blog/route-lock.js";
import { sendRouteCollision } from "./route-collision.js";

const DEFAULT_SITE_KEY = "demo";

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function handleLocaleMutationError(
  error: unknown,
  reply: FastifyReply,
  request: FastifyRequest,
  context: { op: string; siteId: string; localeId?: string }
) {
  if (error instanceof RouteCollisionError || isUniqueConstraintError(error)) {
    request.log.warn({ ...context, err: error }, `${context.op} rejected`);
    request.log.info(context, `${context.op} NO-OP — rejected`);
    if (error instanceof RouteCollisionError) return sendRouteCollision(reply, error);
    return reply.status(409).send({ error: "A locale with this code already exists" });
  }
  request.log.error({ ...context, err: error }, `${context.op} failed`);
  throw error;
}

async function moveBloglistContent(tx: Tx, siteId: string, oldCode: string, newCode: string) {
  if (oldCode === newCode) return;
  const rows = await tx.content.findMany({ where: { page: { siteId }, type: "bloglist", locale: oldCode } });
  for (const row of rows) {
    await tx.content.upsert({
      where: { pageId_key_locale: { pageId: row.pageId, key: row.key, locale: newCode } },
      create: { pageId: row.pageId, key: row.key, locale: newCode, type: "bloglist", value: row.value },
      update: { type: "bloglist", value: row.value },
    });
    await tx.content.delete({ where: { id: row.id } });
  }
}

interface CreateLocaleBody {
  code: string;
  label: string;
  isDefault?: boolean;
  sortOrder?: number;
}

interface UpdateLocaleBody {
  code?: string;
  label?: string;
  isDefault?: boolean;
  sortOrder?: number;
}

function normalizeLocaleCode(code: string): string {
  return code.trim().toLowerCase();
}

async function createLocaleForSite(app: FastifyInstance, siteId: string, body: CreateLocaleBody, reply: FastifyReply, request: FastifyRequest) {
  const context = { op: "locale.create", siteId };
  request.log.info(context, "locale.create requested");
  const { code, label, isDefault = false, sortOrder = 0 } = body ?? {};
  const normalizedCode = typeof code === "string" ? normalizeLocaleCode(code) : "";
  const normalizedLabel = typeof label === "string" ? label.trim() : "";

  if (!normalizedCode || !normalizedLabel) {
    request.log.info(context, "locale.create NO-OP — code and label are required");
    return reply.status(400).send({ error: "code and label are required" });
  }

  try {
    const locale = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      if (isDefault) {
        const site = await tx.site.findUniqueOrThrow({ where: { id: siteId } });
        await moveBloglistContent(tx, siteId, site.defaultLocale, normalizedCode);
        await tx.locale.updateMany({
          where: { siteId, isDefault: true },
          data: { isDefault: false },
        });
        await tx.site.update({
          where: { id: siteId },
          data: { defaultLocale: normalizedCode },
        });
      }

      const created = await tx.locale.create({
        data: { siteId, code: normalizedCode, label: normalizedLabel, isDefault, sortOrder },
      });
      assertNoRouteCollisions(await collectSiteRoutes(tx, siteId));
      return created;
    }, { timeout: 15000 });

    request.log.info({ ...context, locale: locale.code }, "locale.create done");
    return reply.status(201).send(locale);
  } catch (error) {
    return handleLocaleMutationError(error, reply, request, context);
  }
}

async function updateLocaleForSite(
  app: FastifyInstance,
  siteId: string,
  id: string,
  body: UpdateLocaleBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const context = { op: "locale.update", siteId, localeId: id };
  request.log.info(context, "locale.update requested");
  const hasCode = body?.code !== undefined;
  const hasLabel = body?.label !== undefined;
  const hasDefault = body?.isDefault !== undefined;
  const hasSortOrder = body?.sortOrder !== undefined;

  if (!hasCode && !hasLabel && !hasDefault && !hasSortOrder) {
    request.log.info(context, "locale.update NO-OP — no fields supplied");
    return reply.status(400).send({ error: "At least one locale field is required" });
  }

  const nextCode = hasCode ? (typeof body.code === "string" ? normalizeLocaleCode(body.code) : "") : undefined;
  const nextLabel = hasLabel ? (typeof body.label === "string" ? body.label.trim() : "") : undefined;

  if (hasCode && !nextCode) {
    request.log.info(context, "locale.update NO-OP — invalid code");
    return reply.status(400).send({ error: "code cannot be empty" });
  }

  if (hasLabel && !nextLabel) {
    request.log.info(context, "locale.update NO-OP — invalid label");
    return reply.status(400).send({ error: "label cannot be empty" });
  }

  try {
    const updated = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      const existing = await tx.locale.findFirst({ where: { id, siteId } });
      if (!existing) return null;

      const code = nextCode ?? existing.code;
      const shouldBeDefault = body.isDefault === true || existing.isDefault;

      if (body.isDefault === true) {
        await tx.locale.updateMany({
          where: { siteId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const locale = await tx.locale.update({
        where: { id },
        data: {
          ...(nextCode !== undefined && { code: nextCode }),
          ...(nextLabel !== undefined && { label: nextLabel }),
          ...(hasSortOrder && { sortOrder: body.sortOrder }),
          ...(body.isDefault === true && { isDefault: true }),
        },
      });

      if (nextCode !== undefined && nextCode !== existing.code) {
        const pages = await tx.page.findMany({ where: { siteId }, select: { id: true } });
        const pageIds = pages.map((page) => page.id);

        if (pageIds.length > 0) {
          await tx.content.updateMany({
            where: { pageId: { in: pageIds }, locale: existing.code },
            data: { locale: nextCode },
          });
        }

        await tx.blogPostTranslation.updateMany({
          where: { post: { siteId }, locale: existing.code },
          data: { locale: nextCode },
        });
        await tx.blogCategoryName.updateMany({
          where: { category: { siteId }, locale: existing.code },
          data: { locale: nextCode },
        });
        await tx.blogTagName.updateMany({
          where: { tag: { siteId }, locale: existing.code },
          data: { locale: nextCode },
        });
        await tx.navigation.updateMany({
          where: { siteId, locale: existing.code },
          data: { locale: nextCode },
        });
      }

      const site = await tx.site.findUniqueOrThrow({ where: { id: siteId } });
      if (shouldBeDefault) {
        await moveBloglistContent(tx, siteId, site.defaultLocale, code);
        await tx.site.update({
          where: { id: siteId },
          data: { defaultLocale: code },
        });
      }

      assertNoRouteCollisions(await collectSiteRoutes(tx, siteId));
      const changed = locale.code !== existing.code || locale.label !== existing.label
        || locale.sortOrder !== existing.sortOrder || locale.isDefault !== existing.isDefault
        || (shouldBeDefault && site.defaultLocale !== code);
      return { locale, changed };
    }, { timeout: 15000 });

    if (!updated) {
      request.log.info(context, "locale.update NO-OP — locale not found");
      return reply.status(404).send({ error: "Locale not found" });
    }

    request.log.info({ ...context, locale: updated.locale.code }, updated.changed ? "locale.update done" : "locale.update NO-OP — unchanged");
    return reply.send(updated.locale);
  } catch (error) {
    return handleLocaleMutationError(error, reply, request, context);
  }
}

async function deleteLocaleForSite(app: FastifyInstance, siteId: string, id: string, reply: FastifyReply, request: FastifyRequest) {
  const context = { op: "locale.delete", siteId, localeId: id };
  request.log.info(context, "locale.delete requested");
  try {
    const result = await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      const existing = await tx.locale.findFirst({ where: { id, siteId } });
      if (!existing) return { status: 404, body: { error: "Locale not found" } };
      const site = await tx.site.findUniqueOrThrow({ where: { id: siteId } });
      if (existing.isDefault || site.defaultLocale === existing.code) {
        return { status: 409, body: { error: `Locale ${existing.code} is the default locale; make another locale the default first` } };
      }
      const posts = await tx.blogPost.findMany({
        where: { siteId, translations: { some: { locale: existing.code } } },
        select: { key: true },
        orderBy: { key: "asc" },
      });
      if (posts.length > 0) {
        return { status: 409, body: { error: `Locale ${existing.code} has translations for posts: ${posts.map((post) => post.key).join(", ")}` } };
      }
      await tx.blogCategoryName.deleteMany({ where: { category: { siteId }, locale: existing.code } });
      await tx.blogTagName.deleteMany({ where: { tag: { siteId }, locale: existing.code } });
      await tx.locale.delete({ where: { id } });
      assertNoRouteCollisions(await collectSiteRoutes(tx, siteId));
      return { status: 200, body: { ok: true } };
    }, { timeout: 15000 });
    if (result.status === 409) request.log.warn({ ...context, reason: result.body.error }, "locale.delete rejected");
    request.log.info(context, result.status === 200 ? "locale.delete done" : "locale.delete NO-OP — refused or nothing matched");
    return reply.status(result.status).send(result.body);
  } catch (error) {
    return handleLocaleMutationError(error, reply, request, context);
  }
}

export async function registerSiteLocalesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: { siteKey: string } }>("/:siteKey/locales", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const locales = await app.prisma.locale.findMany({
      where: { siteId: site.id },
      orderBy: { sortOrder: "asc" },
    });
    return reply.send(locales);
  });

  app.post<{ Params: { siteKey: string }; Body: CreateLocaleBody }>("/:siteKey/locales", { preHandler: app.requireRole("admin") }, async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return createLocaleForSite(app, site.id, request.body, reply, request);
  });

  app.patch<{ Params: { siteKey: string; id: string }; Body: UpdateLocaleBody }>(
    "/:siteKey/locales/:id",
    { preHandler: app.requireRole("admin") },
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      return updateLocaleForSite(app, site.id, request.params.id, request.body, reply, request);
    }
  );

  app.delete<{ Params: { siteKey: string; id: string } }>("/:siteKey/locales/:id", { preHandler: app.requireRole("admin") }, async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const { id } = request.params;

    return deleteLocaleForSite(app, site.id, id, reply, request);
  });
}

export default async function localesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  // GET / — return all locales ordered by sortOrder asc
  app.get("/", async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    const locales = await app.prisma.locale.findMany({
      where: { siteId: site.id },
      orderBy: { sortOrder: "asc" },
    });
    return reply.send(locales);
  });

  // POST / — create a locale
  app.post<{ Body: CreateLocaleBody }>("/", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return createLocaleForSite(app, site.id, request.body, reply, request);
  });

  app.patch<{ Params: { id: string }; Body: UpdateLocaleBody }>("/:id", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return updateLocaleForSite(app, site.id, request.params.id, request.body, reply, request);
  });

  // DELETE /:id — delete a locale by id
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const site = await requireSite(app, DEFAULT_SITE_KEY);

    return deleteLocaleForSite(app, site.id, id, reply, request);
  });
}
