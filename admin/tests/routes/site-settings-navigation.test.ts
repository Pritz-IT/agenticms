import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.navigation.deleteMany();
  await app.prisma.stagingAccess.deleteMany();
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user } = await createTestUser(app, { role: "admin" });
  token = getAccessToken(user);
});

async function createSite(key: string, name: string) {
  return app.prisma.site.create({
    data: {
      key,
      name,
      domain: `${key}.local`,
      stagingDomain: `staging.${key}.local`,
      defaultLocale: key === "demo" ? "de" : "en",
      siteUrl: `https://${key}.local`,
    },
  });
}

describe("site-scoped settings, navigation, and staging access", () => {
  it("updates settings for one site without changing another", async () => {
    const demo = await createSite("demo", "Demo Site");
    const agenticms = await createSite("agenticms", "AgentiCMS");

    const res = await app.inject({
      method: "PUT",
      url: "/api/sites/demo/settings",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Demo Site AG",
        domain: "example.com",
        stagingDomain: "staging.example.com",
        defaultLocale: "de",
        siteUrl: "https://example.com",
      },
    });

    expect(res.statusCode).toBe(200);
    await expect(app.prisma.site.findUnique({ where: { id: demo.id } })).resolves.toMatchObject({
      name: "Demo Site AG",
      domain: "example.com",
    });
    await expect(app.prisma.site.findUnique({ where: { id: agenticms.id } })).resolves.toMatchObject({
      name: "AgentiCMS",
      domain: "agenticms.local",
    });

    const readBack = await app.inject({
      method: "GET",
      url: "/api/sites/demo/settings",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(readBack.statusCode).toBe(200);
    expect(readBack.json()).toMatchObject({ key: "demo", name: "Demo Site AG" });
  });

  it("lists and mutates navigation within the requested site only", async () => {
    const demo = await createSite("demo", "Demo Site");
    const agenticms = await createSite("agenticms", "AgentiCMS");
    const demoPage = await app.prisma.page.create({
      data: { siteId: demo.id, path: "/about", sortOrder: 0 },
    });
    const foreignPage = await app.prisma.page.create({
      data: { siteId: agenticms.id, path: "/about", sortOrder: 0 },
    });

    const rejected = await app.inject({
      method: "POST",
      url: "/api/sites/demo/navigation",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: "de", label: "Wrong site", targetPageId: foreignPage.id },
    });
    expect(rejected.statusCode).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/sites/demo/navigation",
      headers: { authorization: `Bearer ${token}` },
      payload: { locale: "de", label: "About", targetPageId: demoPage.id, sortOrder: 1 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ siteId: demo.id, targetPageId: demoPage.id });

    const foreignNav = await app.prisma.navigation.create({
      data: { siteId: agenticms.id, locale: "de", label: "AgentiCMS", sortOrder: 0 },
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/sites/demo/navigation?locale=de",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().map((item: { label: string }) => item.label)).toEqual(["About"]);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/sites/demo/navigation/${created.json().id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { label: "About us" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().label).toBe("About us");

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/navigation/${foreignNav.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(foreignDelete.statusCode).toBe(404);

    const ownDelete = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/navigation/${created.json().id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ownDelete.statusCode).toBe(200);
  });

  it("lists and deletes staging access within the requested site only", async () => {
    const demo = await createSite("demo", "Demo Site");
    const agenticms = await createSite("agenticms", "AgentiCMS");
    const foreignEntry = await app.prisma.stagingAccess.create({
      data: { siteId: agenticms.id, username: "agenticms-preview", passwordHash: "hash" },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/sites/demo/staging-access",
      headers: { authorization: `Bearer ${token}` },
      payload: { username: "demo-preview", password: "secret" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ siteId: demo.id, username: "demo-preview" });
    expect(created.json()).not.toHaveProperty("passwordHash");

    const listed = await app.inject({
      method: "GET",
      url: "/api/sites/demo/staging-access",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().map((entry: { username: string }) => entry.username)).toEqual(["demo-preview"]);

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/staging-access/${foreignEntry.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(foreignDelete.statusCode).toBe(404);
    await expect(app.prisma.stagingAccess.findUnique({ where: { id: foreignEntry.id } })).resolves.toBeTruthy();

    const ownDelete = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/staging-access/${created.json().id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ownDelete.statusCode).toBe(200);
  });
});
