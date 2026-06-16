import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let adminToken: string;
let editorToken: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: admin } = await createTestUser(app, { role: "admin" });
  adminToken = getAccessToken(admin);

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);

  // Seed the default site used by the transitional legacy settings route.
  await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Test Site",
      domain: "https://example.com",
      stagingDomain: "https://staging.example.com",
      defaultLocale: "en",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------
describe("GET /api/settings", () => {
  it("returns settings for admin (200)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      name: "Test Site",
      domain: "https://example.com",
      stagingDomain: "https://staging.example.com",
      defaultLocale: "en",
    });
  });

  it("returns 403 for editor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/settings",
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// ---------------------------------------------------------------------------
describe("PUT /api/settings", () => {
  it("updates settings for admin (200)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Updated Site", domain: "https://updated.com" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Updated Site");
    expect(body.domain).toBe("https://updated.com");
    // Unchanged fields stay
    expect(body.stagingDomain).toBe("https://staging.example.com");
    expect(body.defaultLocale).toBe("en");
  });

  it("returns 404 when the default site does not exist", async () => {
    await app.prisma.site.deleteMany();

    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "New Site",
        domain: "https://new.com",
        stagingDomain: "https://staging.new.com",
        defaultLocale: "de",
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for editor", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { name: "Should not update" },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings — the admin frontend sends PATCH for partial saves.
// Regression: this 404'd in prod ({"error":"Not Found"}) — no PATCH handler.
// ---------------------------------------------------------------------------
describe("PATCH /api/settings", () => {
  it("partial-updates for admin (200) without clobbering other fields", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Patched Site" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Patched Site");
    expect(body.domain).toBe("https://example.com");
  });

  it("returns 403 for editor", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { name: "nope" },
    });
    expect(res.statusCode).toBe(403);
  });
});
