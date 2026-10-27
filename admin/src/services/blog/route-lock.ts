import type { Prisma } from "@prisma/client";
import { pageRouteSlug, postUrlPath, slugToUrlPath } from "./urls.js";

export type Tx = Prisma.TransactionClient;
export type SiteRoute = { url: string; owner: string };

export class RouteCollisionError extends Error {
  constructor(public readonly conflicts: { url: string; owners: [string, string] }[]) {
    super(`Route collisions: ${conflicts.map(({ url, owners }) => `${url}: ${owners.join(" and ")}`).join("; ")}`);
    this.name = "RouteCollisionError";
  }
}

export async function lockSiteRoutes(tx: Tx, siteId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${siteId}))`;
}

export async function collectSiteRoutes(tx: Tx, siteId: string): Promise<SiteRoute[]> {
  const site = await tx.site.findUniqueOrThrow({ where: { id: siteId }, select: { defaultLocale: true } });
  const locales = await tx.locale.findMany({ where: { siteId }, select: { code: true }, orderBy: { code: "asc" } });
  const pages = await tx.page.findMany({ where: { siteId }, select: { path: true }, orderBy: { path: "asc" } });
  const posts = await tx.blogPost.findMany({
    where: { siteId },
    select: {
      key: true,
      category: { select: { page: { select: { path: true } } } },
      translations: { select: { locale: true, slug: true }, orderBy: { locale: "asc" } },
    },
    orderBy: { key: "asc" },
  });

  const routes: SiteRoute[] = pages.flatMap((page) => locales.map(({ code }) => ({
    url: slugToUrlPath(pageRouteSlug(page.path, code, site.defaultLocale)),
    owner: `page ${page.path} (${code})`,
  })));
  for (const post of posts) {
    for (const translation of post.translations) {
      routes.push({
        url: postUrlPath(post.category.page.path, translation.locale, site.defaultLocale, translation.slug),
        owner: `post ${post.key} (${translation.locale})`,
      });
    }
  }
  // ponytail: omit pagination routes; page segments cannot start with __ and post slugs cannot contain _.
  return routes;
}

export function assertNoRouteCollisions(routes: SiteRoute[]): void {
  const owners = new Map<string, string>();
  const conflicts: RouteCollisionError["conflicts"] = [];
  for (const route of routes) {
    const owner = owners.get(route.url);
    if (owner !== undefined) {
      conflicts.push({ url: route.url, owners: [owner, route.owner] });
    } else {
      owners.set(route.url, route.owner);
    }
  }
  if (conflicts.length > 0) throw new RouteCollisionError(conflicts);
}
