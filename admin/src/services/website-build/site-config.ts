import type { PrismaClient } from "@prisma/client";
import type { SiteConfig } from "./types.js";
import { loadBlogPostViews } from "../blog/views.js";
import { blogListDefaults, parsePageBlogListFilters, resolveBlogList } from "../blog/bloglist.js";
import { collectSiteRoutes, assertNoRouteCollisions } from "../blog/route-lock.js";

// Builds the SiteConfig used to drive an astro build. Previously this was
// served over HTTP by `GET /api/config` and fetched by the Website container;
// now it's an in-process query.
export async function buildSiteConfig(prisma: PrismaClient, siteKey: string, target: "staging" | "production"): Promise<SiteConfig> {
  const site = await prisma.site.findUnique({ where: { key: siteKey } });
  if (!site) {
    throw new Error(`Unknown site: ${siteKey}`);
  }

  const [locales, layouts, pages, navigation, stagingAccess, assets, views, routes] = await Promise.all([
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
    loadBlogPostViews(prisma, site.id, target),
    collectSiteRoutes(prisma, site.id),
  ]);

  assertNoRouteCollisions(routes);
  const postLayouts = await prisma.blogPost.findMany({
    where: { siteId: site.id, key: { in: [...new Set(views.map(({ key }) => key))] } },
    select: { key: true, layoutId: true, category: { select: { defaultLayoutId: true } } },
  });
  const layoutsById = new Map(layouts.map((layout) => [layout.id, layout]));
  const layoutPaths = new Map(postLayouts.map((post) => {
    const layout = layoutsById.get(post.layoutId ?? post.category.defaultLayoutId);
    if (!layout) throw new Error(`Post ${post.key}: layout is missing for this site`);
    if (layout.kind !== "post") throw new Error(`Post ${post.key}: layout ${layout.filePath} must be kind post`);
    return [post.key, layout.filePath];
  }));
  const posts = views.map((post) => {
    const layoutFilePath = layoutPaths.get(post.key);
    if (!layoutFilePath) throw new Error(`Post ${post.key}: layout is missing for this site`);
    return { ...post, layoutFilePath };
  });
  const blogLists: SiteConfig["blogLists"] = {};
  for (const page of pages) {
    const values = Object.fromEntries(Object.entries(blogListDefaults(page.layout?.detectedKeys)).map(([key, initial]) => [
      key, page.contents.find((content) => content.key === key && content.locale === site.defaultLocale)?.value ?? initial,
    ]));
    for (const [fieldKey, filter] of Object.entries(parsePageBlogListFilters(page.path, values))) {
      for (const { code } of locales) {
        blogLists[page.id] ??= {};
        blogLists[page.id][code] ??= {};
        blogLists[page.id][code][fieldKey] = {
          postKeys: resolveBlogList(posts, filter, code).map(({ key }) => key),
          pageSize: filter.pageSize,
        };
      }
    }
  }

  // Prisma's return types are stricter than what the SiteConfig contract on
  // disk requires (dates land as ISO strings via JSON.stringify, JsonValue
  // collapses to Record). Cast through `unknown` to satisfy the compiler.
  return { settings: site, locales, layouts, pages, navigation, stagingAccess, assets, buildTarget: target, posts, blogLists } as unknown as SiteConfig;
}
