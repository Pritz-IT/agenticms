import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { requireSite } from "../services/sites.js";

const DEFAULT_SITE_KEY = "demo";

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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

async function createLocaleForSite(app: FastifyInstance, siteId: string, body: CreateLocaleBody, reply: FastifyReply) {
  const { code, label, isDefault = false, sortOrder = 0 } = body ?? {};
  const normalizedCode = code ? normalizeLocaleCode(code) : "";
  const normalizedLabel = label?.trim() ?? "";

  if (!normalizedCode || !normalizedLabel) {
    return reply.status(400).send({ error: "code and label are required" });
  }

  try {
    const locale = await app.prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.locale.updateMany({
          where: { siteId, isDefault: true },
          data: { isDefault: false },
        });
        await tx.site.update({
          where: { id: siteId },
          data: { defaultLocale: normalizedCode },
        });
      }

      return tx.locale.create({
        data: { siteId, code: normalizedCode, label: normalizedLabel, isDefault, sortOrder },
      });
    });

    return reply.status(201).send(locale);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.status(409).send({ error: "A locale with this code already exists" });
    }
    throw error;
  }
}

async function updateLocaleForSite(
  app: FastifyInstance,
  siteId: string,
  id: string,
  body: UpdateLocaleBody,
  reply: FastifyReply
) {
  const hasCode = body?.code !== undefined;
  const hasLabel = body?.label !== undefined;
  const hasDefault = body?.isDefault !== undefined;
  const hasSortOrder = body?.sortOrder !== undefined;

  if (!hasCode && !hasLabel && !hasDefault && !hasSortOrder) {
    return reply.status(400).send({ error: "At least one locale field is required" });
  }

  const nextCode = hasCode ? normalizeLocaleCode(String(body.code)) : undefined;
  const nextLabel = hasLabel ? String(body.label).trim() : undefined;

  if (hasCode && !nextCode) {
    return reply.status(400).send({ error: "code cannot be empty" });
  }

  if (hasLabel && !nextLabel) {
    return reply.status(400).send({ error: "label cannot be empty" });
  }

  try {
    const updated = await app.prisma.$transaction(async (tx) => {
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

        await tx.navigation.updateMany({
          where: { siteId, locale: existing.code },
          data: { locale: nextCode },
        });
      }

      if (shouldBeDefault) {
        await tx.site.update({
          where: { id: siteId },
          data: { defaultLocale: code },
        });
      }

      return locale;
    });

    if (!updated) {
      return reply.status(404).send({ error: "Locale not found" });
    }

    return reply.send(updated);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return reply.status(409).send({ error: "A locale with this code already exists" });
    }
    throw error;
  }
}

export async function registerSiteLocalesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get<{ Params: { siteKey: string } }>("/:siteKey/locales", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const locales = await app.prisma.locale.findMany({
      where: { siteId: site.id },
      orderBy: { sortOrder: "asc" },
    });
    return reply.send(locales);
  });

  app.post<{ Params: { siteKey: string }; Body: CreateLocaleBody }>("/:siteKey/locales", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return createLocaleForSite(app, site.id, request.body, reply);
  });

  app.patch<{ Params: { siteKey: string; id: string }; Body: UpdateLocaleBody }>(
    "/:siteKey/locales/:id",
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      return updateLocaleForSite(app, site.id, request.params.id, request.body, reply);
    }
  );

  app.delete<{ Params: { siteKey: string; id: string } }>("/:siteKey/locales/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const { id } = request.params;

    const existing = await app.prisma.locale.findFirst({ where: { id, siteId: site.id } });
    if (!existing) {
      return reply.status(404).send({ error: "Locale not found" });
    }

    await app.prisma.locale.delete({ where: { id } });
    return reply.send({ ok: true });
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
    return createLocaleForSite(app, site.id, request.body, reply);
  });

  app.patch<{ Params: { id: string }; Body: UpdateLocaleBody }>("/:id", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return updateLocaleForSite(app, site.id, request.params.id, request.body, reply);
  });

  // DELETE /:id — delete a locale by id
  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;
    const site = await requireSite(app, DEFAULT_SITE_KEY);

    const existing = await app.prisma.locale.findFirst({ where: { id, siteId: site.id } });
    if (!existing) {
      return reply.status(404).send({ error: "Locale not found" });
    }

    await app.prisma.locale.delete({ where: { id } });
    return reply.send({ ok: true });
  });
}
