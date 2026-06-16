import type { FastifyInstance } from "fastify";

const DEFAULT_SITE_KEY = "demo";

export default async function configRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireInternalKey);

  // GET / — returns the complete site config for the Website container
  app.get("/", async (request, reply) => {
    const host = request.headers.host?.split(":")[0] ?? "";
    const site = (await app.prisma.site.findFirst({
      where: { OR: [{ domain: host }, { stagingDomain: host }] },
    })) ?? (await app.prisma.site.findUnique({ where: { key: DEFAULT_SITE_KEY } }));

    if (!site) {
      return reply.status(404).send({ error: "Site not found" });
    }

    const [locales, layouts, pages, navigation, stagingAccess, assets] = await Promise.all([
      app.prisma.locale.findMany({ where: { siteId: site.id }, orderBy: { sortOrder: "asc" } }),
      app.prisma.layout.findMany({ where: { siteId: site.id } }),
      app.prisma.page.findMany({
        where: { siteId: site.id, isPublished: true },
        include: { layout: true, contents: true },
        orderBy: { sortOrder: "asc" },
      }),
      app.prisma.navigation.findMany({
        include: {
          targetPage: true,
          children: {
            where: { siteId: site.id },
            include: {
              targetPage: true,
              children: {
                where: { siteId: site.id },
                include: { targetPage: true },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        where: { siteId: site.id, parentId: null },
        orderBy: { sortOrder: "asc" },
      }),
      // NOTE: stagingAccess intentionally includes password_hash — the Website
      // container uses these hashes to generate nginx Basic Auth configuration.
      app.prisma.stagingAccess.findMany({ where: { siteId: site.id } }),
      app.prisma.asset.findMany({ where: { siteId: site.id }, select: { id: true, filename: true, filePath: true } }),
    ]);

    return reply.send({ settings: site, locales, layouts, pages, navigation, stagingAccess, assets });
  });
}
