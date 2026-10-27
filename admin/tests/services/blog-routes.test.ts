import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { pageRouteSlug, postUrlPath, slugToUrlPath } from "../../src/services/blog/urls.js";
import { assertNoRouteCollisions, collectSiteRoutes, lockSiteRoutes, RouteCollisionError } from "../../src/services/blog/route-lock.js";
import { createBlogFixture } from "../helpers/blog.js";

describe("blog URL helpers", () => {
  it.each([
    ["/playbooks", "de", "de", "playbooks", "/playbooks/"],
    ["/playbooks", "en", "de", "en/playbooks", "/en/playbooks/"],
    ["/", "de", "de", undefined, "/"],
    ["/", "en", "de", "en", "/en/"],
    ["", "de", "de", undefined, "/"],
    ["//", "en", "de", "en", "/en/"],
    ["news/", "de", "de", "news/", "/news//"],
  ])("mirrors page route semantics for %s (%s)", (path, locale, defaultLocale, slug, url) => {
    expect(pageRouteSlug(path, locale, defaultLocale)).toBe(slug);
    expect(slugToUrlPath(slug)).toBe(url);
  });

  it("builds post URLs for default and non-default locales", () => {
    expect(postUrlPath("/playbooks", "de", "de", "x")).toBe("/playbooks/x/");
    expect(postUrlPath("/playbooks", "en", "de", "x")).toBe("/en/playbooks/x/");
    expect(slugToUrlPath()).toBe("/");
  });

  it("names both owners of a page/post collision", () => {
    const routes = [
      { url: "/news/x/", owner: "page /news/x (de)" },
      { url: postUrlPath("/news", "de", "de", "x"), owner: "post school-bus-routing (de)" },
    ];
    expect(() => assertNoRouteCollisions(routes)).toThrow(RouteCollisionError);
    expect(() => assertNoRouteCollisions(routes)).toThrow("page /news/x (de)");
    expect(() => assertNoRouteCollisions(routes)).toThrow("post school-bus-routing (de)");
    try {
      assertNoRouteCollisions(routes);
    } catch (error) {
      expect(error).toMatchObject({ conflicts: [{ url: "/news/x/", owners: routes.map((route) => route.owner) }] });
    }
    expect(() => assertNoRouteCollisions([routes[0], { url: "/other/", owner: "page /other (de)" }])).not.toThrow();
  });
});

describe("site route collection and lock", () => {
  let app: FastifyInstance;
  let siteId: string;
  beforeAll(async () => { app = await buildApp({ logger: false }); await app.ready(); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await app.prisma.blogPost.deleteMany();
    await app.prisma.blogCategory.deleteMany();
    await app.prisma.site.deleteMany();
    const site = await app.prisma.site.create({
      data: { key: "demo", name: "Demo", domain: "demo.test", stagingDomain: "staging.demo.test", defaultLocale: "de" },
    });
    siteId = site.id;
    await app.prisma.locale.createMany({ data: [
      { siteId, code: "de", label: "Deutsch", isDefault: false },
      { siteId, code: "en", label: "English", isDefault: true },
    ] });
  });

  it("collects all pages and draft/published translations using Site.defaultLocale, scoped to the site", async () => {
    await createBlogFixture(app, siteId);
    const other = await app.prisma.site.create({
      data: { key: "other", name: "Other", domain: "other.test", stagingDomain: "staging.other.test", defaultLocale: "de" },
    });
    await createBlogFixture(app, other.id);
    const routes = await app.prisma.$transaction((tx) => collectSiteRoutes(tx, siteId));
    expect(routes).toHaveLength(4);
    expect(routes).toEqual(expect.arrayContaining([
      { url: "/news/", owner: "page /news (de)" },
      { url: "/en/news/", owner: "page /news (en)" },
      { url: "/news/x/", owner: "post school-bus-routing (de)" },
      { url: "/en/news/x/", owner: "post school-bus-routing (en)" },
    ]));
  });

  it("holds the transaction lock only for the requested site and releases it at commit", async () => {
    await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, siteId);
      await app.prisma.$transaction(async (other) => {
        const [same] = await other.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${siteId})) AS locked`;
        const [different] = await other.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${"another-site"})) AS locked`;
        expect(same.locked).toBe(false);
        expect(different.locked).toBe(true);
      });
    });
    await app.prisma.$transaction(async (tx) => {
      const [released] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${siteId})) AS locked`;
      expect(released.locked).toBe(true);
    });
  });
});
