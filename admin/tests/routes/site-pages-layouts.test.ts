import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let adminToken: string;

const layoutKeys = {
  "hero.title": { type: "text", initial: "Welcome" },
};

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.content.deleteMany();
  await app.prisma.navigation.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: admin } = await createTestUser(app, { role: "admin" });
  adminToken = getAccessToken(admin);
});

async function createSite(key: string) {
  return app.prisma.site.create({
    data: {
      key,
      name: `${key} site`,
      domain: `${key}.example.com`,
      stagingDomain: `staging-${key}.example.com`,
      defaultLocale: "en",
      siteUrl: `https://${key}.example.com`,
    },
  });
}

describe("site-scoped pages, layouts, locales, and content", () => {
  it("keeps duplicate paths, layout paths, locale codes, and content scoped to each site", async () => {
    const demo = await createSite("demo");
    const acme = await createSite("acme");

    const demoLocale = await app.inject({
      method: "POST",
      url: "/api/sites/demo/locales",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { code: "en", label: "English", isDefault: true },
    });
    const acmeLocale = await app.inject({
      method: "POST",
      url: "/api/sites/acme/locales",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { code: "en", label: "English", isDefault: true },
    });

    expect(demoLocale.statusCode).toBe(201);
    expect(acmeLocale.statusCode).toBe(201);

    const demoLayout = await app.prisma.layout.create({
      data: {
        siteId: demo.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: layoutKeys,
      },
    });
    const acmeLayout = await app.prisma.layout.create({
      data: {
        siteId: acme.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: layoutKeys,
      },
    });

    const demoPageRes = await app.inject({
      method: "POST",
      url: "/api/sites/demo/pages",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { path: "/home", layoutId: demoLayout.id },
    });
    const acmePageRes = await app.inject({
      method: "POST",
      url: "/api/sites/acme/pages",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { path: "/home", layoutId: acmeLayout.id },
    });
    const crossSiteLayoutRes = await app.inject({
      method: "POST",
      url: "/api/sites/demo/pages",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { path: "/wrong-layout", layoutId: acmeLayout.id },
    });

    expect(demoPageRes.statusCode).toBe(201);
    expect(acmePageRes.statusCode).toBe(201);
    expect(crossSiteLayoutRes.statusCode).toBe(400);

    const demoPage = demoPageRes.json();
    const acmePage = acmePageRes.json();

    const demoPages = await app.inject({
      method: "GET",
      url: "/api/sites/demo/pages",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const acmePages = await app.inject({
      method: "GET",
      url: "/api/sites/acme/pages",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const demoLayouts = await app.inject({
      method: "GET",
      url: "/api/sites/demo/layouts",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(demoPages.statusCode).toBe(200);
    expect(demoPages.json().map((page: { id: string }) => page.id)).toEqual([demoPage.id]);
    expect(acmePages.statusCode).toBe(200);
    expect(acmePages.json().map((page: { id: string }) => page.id)).toEqual([acmePage.id]);
    expect(demoLayouts.statusCode).toBe(200);
    expect(demoLayouts.json().map((layout: { id: string }) => layout.id)).toEqual([demoLayout.id]);

    const contentRows = await app.prisma.content.findMany({
      orderBy: { pageId: "asc" },
    });
    expect(contentRows).toHaveLength(2);

    const updateContent = await app.inject({
      method: "PUT",
      url: `/api/sites/demo/content/${demoPage.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { key: "hero.title", locale: "en", value: "Demo title", type: "text" },
    });
    const crossSiteContent = await app.inject({
      method: "GET",
      url: `/api/sites/demo/content/${acmePage.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(updateContent.statusCode).toBe(200);
    expect(updateContent.json()).toMatchObject({
      pageId: demoPage.id,
      key: "hero.title",
      locale: "en",
      value: "Demo title",
    });
    expect(crossSiteContent.statusCode).toBe(404);
  });

  it("deletes, cleans orphaned, and resets content only for pages on the selected site", async () => {
    const demo = await createSite("demo");
    const acme = await createSite("acme");

    const demoLayout = await app.prisma.layout.create({
      data: {
        siteId: demo.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: layoutKeys,
      },
    });
    const acmeLayout = await app.prisma.layout.create({
      data: {
        siteId: acme.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: layoutKeys,
      },
    });
    const demoPage = await app.prisma.page.create({
      data: { siteId: demo.id, path: "/home", layoutId: demoLayout.id },
    });
    const acmePage = await app.prisma.page.create({
      data: { siteId: acme.id, path: "/home", layoutId: acmeLayout.id },
    });

    const acmeEntry = await app.prisma.content.create({
      data: { pageId: acmePage.id, key: "hero.title", locale: "en", value: "Acme", type: "text" },
    });
    const demoEntry = await app.prisma.content.create({
      data: { pageId: demoPage.id, key: "hero.title", locale: "en", value: "Demo", type: "text" },
    });

    const crossDelete = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/content/entries/${acmeEntry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(crossDelete.statusCode).toBe(404);
    await expect(app.prisma.content.findUnique({ where: { id: acmeEntry.id } })).resolves.toBeTruthy();

    const crossUpdate = await app.inject({
      method: "PUT",
      url: `/api/sites/demo/content/entries/${acmeEntry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { value: "Wrong site" },
    });
    expect(crossUpdate.statusCode).toBe(404);
    await expect(app.prisma.content.findUnique({ where: { id: acmeEntry.id } })).resolves.toMatchObject({ value: "Acme" });

    const ownUpdate = await app.inject({
      method: "PUT",
      url: `/api/sites/acme/content/entries/${acmeEntry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { value: "Acme updated" },
    });
    expect(ownUpdate.statusCode).toBe(200);
    expect(ownUpdate.json()).toMatchObject({ id: acmeEntry.id, value: "Acme updated" });

    const ownDelete = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/content/entries/${demoEntry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ownDelete.statusCode).toBe(200);
    expect(ownDelete.json()).toEqual({ ok: true });
    await expect(app.prisma.content.findUnique({ where: { id: demoEntry.id } })).resolves.toBeNull();

    const demoOrphan = await app.prisma.content.create({
      data: { pageId: demoPage.id, key: "stale.key", locale: "en", value: "Remove me", type: "text" },
    });
    const acmeOrphan = await app.prisma.content.create({
      data: { pageId: acmePage.id, key: "stale.key", locale: "en", value: "Keep me", type: "text" },
    });

    const crossOrphaned = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/content/${acmePage.id}/orphaned`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(crossOrphaned.statusCode).toBe(404);
    await expect(app.prisma.content.findUnique({ where: { id: acmeOrphan.id } })).resolves.toBeTruthy();

    const ownOrphaned = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/content/${demoPage.id}/orphaned`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ownOrphaned.statusCode).toBe(200);
    expect(ownOrphaned.json()).toEqual({ deleted: 1 });
    await expect(app.prisma.content.findUnique({ where: { id: demoOrphan.id } })).resolves.toBeNull();

    const demoReset = await app.prisma.content.create({
      data: { pageId: demoPage.id, key: "hero.title", locale: "de", value: "Zuruecksetzen", type: "text" },
    });
    const acmeReset = await app.prisma.content.create({
      data: { pageId: acmePage.id, key: "hero.title", locale: "de", value: "Behalten", type: "text" },
    });

    const crossReset = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/content/${acmePage.id}/reset/de`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(crossReset.statusCode).toBe(404);
    await expect(app.prisma.content.findUnique({ where: { id: acmeReset.id } })).resolves.toBeTruthy();

    const ownReset = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/content/${demoPage.id}/reset/de`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ownReset.statusCode).toBe(200);
    expect(ownReset.json()).toEqual({ deleted: 1 });
    await expect(app.prisma.content.findUnique({ where: { id: demoReset.id } })).resolves.toBeNull();
  });
});
