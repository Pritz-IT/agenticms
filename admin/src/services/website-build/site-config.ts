import type { PrismaClient } from "@prisma/client";
import type { SiteConfig } from "./types.js";

const DEFAULT_SITE_KEY = "demo";

// Builds the SiteConfig used to drive an astro build. Previously this was
// served over HTTP by `GET /api/config` and fetched by the Website container;
// now it's an in-process query.
export async function buildSiteConfig(prisma: PrismaClient, siteKey = DEFAULT_SITE_KEY): Promise<SiteConfig> {
  const site = await prisma.site.findUnique({ where: { key: siteKey } });
  if (!site) {
    throw new Error(`Unknown site: ${siteKey}`);
  }

  const [locales, layouts, pages, navigation, stagingAccess, assets] = await Promise.all([
    prisma.locale.findMany({ where: { siteId: site.id }, orderBy: { sortOrder: "asc" } }),
    prisma.layout.findMany({ where: { siteId: site.id } }),
    prisma.page.findMany({
      where: { siteId: site.id, isPublished: true },
      include: { layout: true, contents: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.navigation.findMany({
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
    // stagingAccess intentionally includes passwordHash — written into
    // .htpasswd-{target} for nginx Basic Auth on staging.
    prisma.stagingAccess.findMany({ where: { siteId: site.id } }),
    prisma.asset.findMany({ where: { siteId: site.id }, select: { id: true, filename: true, filePath: true } }),
  ]);

  // Prisma's return types are stricter than what the SiteConfig contract on
  // disk requires (dates land as ISO strings via JSON.stringify, JsonValue
  // collapses to Record). Cast through `unknown` to satisfy the compiler.
  return { settings: site, locales, layouts, pages, navigation, stagingAccess, assets } as unknown as SiteConfig;
}
