import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser } from "../helpers/auth.js";
import { sha256 } from "../../src/services/cli-auth.js";

let app: FastifyInstance;
let siteId: string;
let cliToken: string;

const detectedKeys = {
  "hero.title": { type: "text", initial: "Hello" },
  "hero.image": { type: "image", initial: "/assets/hero.webp" },
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
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.cliToken.deleteMany();
  await app.prisma.cliDeviceChallenge.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  await app.prisma.site.deleteMany();

  const site = await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
  });
  siteId = site.id;

  await app.prisma.locale.create({ data: { siteId, code: "de", label: "Deutsch", sortOrder: 0 } });
  const { user } = await createTestUser(app, { role: "admin" });
  cliToken = "sfcli_pages_test";
  await app.prisma.cliToken.create({
    data: {
      tokenHash: sha256(cliToken),
      userId: user.id,
      label: "Page CLI",
      scopes: ["pages:write", "status:read"],
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
});

function cliHeaders(token = cliToken) {
  return { authorization: `Bearer ${token}` };
}

describe("site CLI page management", () => {
  it("lists pages with layout metadata", async () => {
    const layout = await app.prisma.layout.create({
      data: { siteId, name: "Home", filePath: "pritz/Home.tsx", detectedKeys },
    });
    await app.prisma.page.createMany({
      data: [
        { siteId, path: "/b", sortOrder: 2 },
        { siteId, path: "/a", layoutId: layout.id, sortOrder: 1, isPublished: true },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([
      { path: "/a", isPublished: true, layout: { filePath: "pritz/Home.tsx" } },
      { path: "/b", isPublished: false, layout: null },
    ]);
  });

  it("creates a page by layout path and prefills content", async () => {
    await app.prisma.layout.create({
      data: { siteId, name: "Home", filePath: "pritz/Home.tsx", detectedKeys },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: {
        path: "/new",
        layout: "pritz/Home.tsx",
        sortOrder: 4,
        isPublished: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      path: "/new",
      sortOrder: 4,
      isPublished: true,
      layout: { filePath: "pritz/Home.tsx" },
    });

    const content = await app.prisma.content.findMany({
      where: { pageId: body.id },
      orderBy: { key: "asc" },
    });
    expect(content).toMatchObject([
      { key: "hero.image", locale: "de", value: "/assets/hero.webp", type: "image" },
      { key: "hero.title", locale: "de", value: "Hello", type: "text" },
    ]);
  });

  it("updates a page by id and can clear the layout", async () => {
    const layout = await app.prisma.layout.create({
      data: { siteId, name: "Home", filePath: "pritz/Home.tsx", detectedKeys },
    });
    const page = await app.prisma.page.create({
      data: { siteId, path: "/old", layoutId: layout.id, sortOrder: 1, isPublished: true },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/sites/demo/cli/pages/${page.id}`,
      headers: cliHeaders(),
      payload: {
        path: "/new",
        layout: null,
        sortOrder: 8,
        isPublished: false,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      id: page.id,
      path: "/new",
      layoutId: null,
      sortOrder: 8,
      isPublished: false,
    });
  });

  it("deletes a page by id", async () => {
    const page = await app.prisma.page.create({ data: { siteId, path: "/delete-me" } });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/cli/pages/${page.id}`,
      headers: cliHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await expect(app.prisma.page.findUnique({ where: { id: page.id } })).resolves.toBeNull();
  });

  it("canonicalizes the path on create and rejects an equivalent duplicate", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: { path: "about/" },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ path: "/about" });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: { path: "/about" },
    });

    expect(duplicate.statusCode).toBe(409);
  });

  it("resolves a layout by name and by unique basename", async () => {
    const layout = await app.prisma.layout.create({
      data: { siteId, name: "Marketing Home", filePath: "pritz/Home.tsx", detectedKeys },
    });

    const byName = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: { path: "/by-name", layout: "Marketing Home" },
    });
    expect(byName.statusCode).toBe(201);
    expect(byName.json()).toMatchObject({ layoutId: layout.id });

    const byBasename = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: { path: "/by-basename", layout: "Home.tsx" },
    });
    expect(byBasename.statusCode).toBe(201);
    expect(byBasename.json()).toMatchObject({ layoutId: layout.id });
  });

  it("rejects an ambiguous layout basename with 400", async () => {
    await app.prisma.layout.create({ data: { siteId, name: "Home A", filePath: "a/Home.tsx", detectedKeys } });
    await app.prisma.layout.create({ data: { siteId, name: "Home B", filePath: "b/Home.tsx", detectedKeys } });

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: { path: "/ambiguous", layout: "Home.tsx" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/ambiguous/i);
  });

  it("rejects an unknown layout with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(),
      payload: { path: "/missing-layout", layout: "does/not/exist.tsx" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not found/i);
  });

  it("requires the pages:write scope", async () => {
    const { user } = await createTestUser(app, { role: "admin", email: "status-only@example.com" });
    const statusOnlyToken = "sfcli_status_only";
    await app.prisma.cliToken.create({
      data: {
        tokenHash: sha256(statusOnlyToken),
        userId: user.id,
        label: "Status only",
        scopes: ["status:read"],
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/cli/pages",
      headers: cliHeaders(statusOnlyToken),
    });

    expect(res.statusCode).toBe(403);
  });
});
