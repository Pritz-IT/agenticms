import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireSite, type SiteParams } from "../services/sites.js";

const DEFAULT_SITE_KEY = "demo";

interface CreateNavItemBody {
  locale: string;
  label: string;
  targetPageId?: string | null;
  parentId?: string | null;
  sortOrder?: number;
}

interface UpdateNavItemBody {
  label?: string;
  targetPageId?: string | null;
  parentId?: string | null;
  sortOrder?: number;
}

async function validateTargetPage(app: FastifyInstance, siteId: string, targetPageId?: string | null) {
  if (!targetPageId) return true;
  const targetPage = await app.prisma.page.findFirst({ where: { id: targetPageId, siteId } });
  return Boolean(targetPage);
}

async function validateParent(app: FastifyInstance, siteId: string, parentId?: string | null) {
  if (!parentId) return true;
  const parent = await app.prisma.navigation.findFirst({ where: { id: parentId, siteId } });
  return Boolean(parent);
}

async function updateNavigationItem(
  app: FastifyInstance,
  siteId: string,
  id: string,
  body: UpdateNavItemBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  request.log.info({ op: "nav.update", siteId, navId: id }, "nav.update requested");
  const { label, targetPageId, parentId, sortOrder } = body ?? {};

  const existing = await app.prisma.navigation.findFirst({ where: { id, siteId } });
  if (!existing) {
    request.log.info({ op: "nav.update", siteId, navId: id }, "nav.update NO-OP — nothing matched");
    return reply.status(404).send({ error: "Navigation item not found" });
  }

  if (!(await validateTargetPage(app, siteId, targetPageId))) {
    return reply.status(400).send({ error: "Target page not found for this site" });
  }
  if (!(await validateParent(app, siteId, parentId))) {
    return reply.status(400).send({ error: "Parent navigation item not found for this site" });
  }

  const item = await app.prisma.navigation.update({
    where: { id },
    data: {
      ...(label !== undefined && { label }),
      ...(targetPageId !== undefined && { targetPageId: targetPageId || null }),
      ...(parentId !== undefined && { parentId: parentId || null }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  });

  request.log.info({ op: "nav.update", siteId, navId: id }, "nav.update done");
  return reply.send(item);
}

async function listNavigation(app: FastifyInstance, siteId: string, locale: string | undefined, reply: FastifyReply) {
  const items = await app.prisma.navigation.findMany({
    where: {
      siteId,
      parentId: null,
      ...(locale && { locale }),
    },
    orderBy: { sortOrder: "asc" },
    include: {
      targetPage: true,
      children: {
        where: { siteId },
        orderBy: { sortOrder: "asc" },
        include: {
          targetPage: true,
          children: {
            where: { siteId },
            orderBy: { sortOrder: "asc" },
            include: { targetPage: true },
          },
        },
      },
    },
  });

  return reply.send(items);
}

async function createNavigationItem(
  app: FastifyInstance,
  siteId: string,
  body: CreateNavItemBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const { locale, label, targetPageId, parentId, sortOrder = 0 } = body ?? {};

  if (!locale || !label) {
    return reply.status(400).send({ error: "locale and label are required" });
  }

  if (!(await validateTargetPage(app, siteId, targetPageId))) {
    return reply.status(400).send({ error: "Target page not found for this site" });
  }
  if (!(await validateParent(app, siteId, parentId))) {
    return reply.status(400).send({ error: "Parent navigation item not found for this site" });
  }

  request.log.info({ op: "nav.create", siteId, locale }, "nav.create requested");

  const item = await app.prisma.navigation.create({
    data: {
      siteId,
      locale,
      label,
      sortOrder,
      targetPageId: targetPageId || null,
      parentId: parentId || null,
    },
  });

  request.log.info({ op: "nav.create", siteId, navId: item.id }, "nav.create done");
  return reply.status(201).send(item);
}

async function deleteNavigationItem(app: FastifyInstance, siteId: string, id: string, reply: FastifyReply, request: FastifyRequest) {
  request.log.info({ op: "nav.delete", siteId, navId: id }, "nav.delete requested");

  const existing = await app.prisma.navigation.findFirst({ where: { id, siteId } });
  if (!existing) {
    request.log.info({ op: "nav.delete", siteId, navId: id }, "nav.delete NO-OP — nothing matched");
    return reply.status(404).send({ error: "Navigation item not found" });
  }

  await app.prisma.$transaction([
    app.prisma.navigation.deleteMany({ where: { parentId: id, siteId } }),
    app.prisma.navigation.delete({ where: { id } }),
  ]);
  request.log.info({ op: "nav.delete", siteId, navId: id }, "nav.delete done");
  return reply.send({ ok: true });
}

export async function registerSiteNavigationRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: SiteParams; Querystring: { locale?: string } }>("/:siteKey/navigation", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return listNavigation(app, site.id, request.query.locale, reply);
  });

  app.post<{ Params: SiteParams; Body: CreateNavItemBody }>("/:siteKey/navigation", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return createNavigationItem(app, site.id, request.body, reply, request);
  });

  app.put<{ Params: SiteParams & { id: string }; Body: UpdateNavItemBody }>("/:siteKey/navigation/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return updateNavigationItem(app, site.id, request.params.id, request.body, reply, request);
  });

  app.patch<{ Params: SiteParams & { id: string }; Body: UpdateNavItemBody }>("/:siteKey/navigation/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return updateNavigationItem(app, site.id, request.params.id, request.body, reply, request);
  });

  app.delete<{ Params: SiteParams & { id: string } }>("/:siteKey/navigation/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return deleteNavigationItem(app, site.id, request.params.id, reply, request);
  });
}

export default async function navigationRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  // GET / — transitional legacy route for the default demo site.
  app.get<{ Querystring: { locale?: string } }>("/", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return listNavigation(app, site.id, request.query.locale, reply);
  });

  app.post<{ Body: CreateNavItemBody }>("/", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return createNavigationItem(app, site.id, request.body, reply, request);
  });

  app.put<{ Params: { id: string }; Body: UpdateNavItemBody }>("/:id", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return updateNavigationItem(app, site.id, request.params.id, request.body, reply, request);
  });

  app.patch<{ Params: { id: string }; Body: UpdateNavItemBody }>("/:id", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return updateNavigationItem(app, site.id, request.params.id, request.body, reply, request);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return deleteNavigationItem(app, site.id, request.params.id, reply, request);
  });
}
