import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { config } from "../../src/config.js";

let app: FastifyInstance;
let adminToken: string;
let adminUserId: string;
let editorToken: string;
let defaultSiteId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await rm(config.BUILDS_DIR, { recursive: true, force: true });
  await app.prisma.stagingAccess.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: admin } = await createTestUser(app, { role: "admin" });
  adminToken = getAccessToken(admin);
  adminUserId = admin.id;

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);

  const site = await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Demo Site",
      domain: "example.com",
      stagingDomain: "staging.example.com",
      defaultLocale: "de",
    },
  });
  defaultSiteId = site.id;
});

// ---------------------------------------------------------------------------
// POST /api/staging-access
// ---------------------------------------------------------------------------
describe("POST /api/staging-access", () => {
  it("creates staging credentials (admin only, 201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "preview-user", password: "s3cr3t!" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body.username).toBe("preview-user");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("accepts product-safe htpasswd usernames", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "preview.user_01-2", password: "s3cr3t!" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().username).toBe("preview.user_01-2");
  });

  it.each([
    ["colon", "preview:user"],
    ["newline", "preview\nuser"],
    ["space", "preview user"],
    ["empty", ""],
    ["too long", "a".repeat(65)],
  ])("rejects staging htpasswd usernames containing %s", async (_label, username) => {
    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username, password: "s3cr3t!" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid staging access username" });
  });

  it("creates credentials with optional expiresAt", async () => {
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "timed-user", password: "pass", expiresAt },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expiresAt).toBeTruthy();
  });

  it("excludes expired credentials from the generated htpasswd file", async () => {
    const expiresAt = new Date(Date.now() - 1000).toISOString();

    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "expired-user", password: "pass", expiresAt },
    });

    expect(res.statusCode).toBe(201);
    await expect(readFile(join(config.BUILDS_DIR, "demo", ".htpasswd-staging"), "utf-8")).resolves.toBe("");
  });

  it("returns 403 for editor role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { username: "x", password: "y" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a stale admin token after the user is demoted", async () => {
    await app.prisma.user.update({
      where: { id: adminUserId },
      data: { role: "editor" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "preview-user", password: "s3cr3t!" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Admin role required" });
  });

  it("rejects a stale admin token after the user is deleted", async () => {
    await app.prisma.user.delete({ where: { id: adminUserId } });

    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { username: "preview-user", password: "s3cr3t!" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "Invalid or expired token" });
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/staging-access",
      payload: { username: "x", password: "y" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/staging-access
// ---------------------------------------------------------------------------
describe("GET /api/staging-access", () => {
  it("lists entries without exposing passwordHash", async () => {
    await app.prisma.stagingAccess.createMany({
      data: [
        { siteId: defaultSiteId, username: "user-a", passwordHash: "hash-a" },
        { siteId: defaultSiteId, username: "user-b", passwordHash: "hash-b" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    for (const entry of body) {
      expect(entry).not.toHaveProperty("passwordHash");
      expect(entry).toHaveProperty("username");
    }
  });

  it("returns 403 for editor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/staging-access",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/staging-access" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/staging-access/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/staging-access/:id", () => {
  it("removes staging credentials", async () => {
    const entry = await app.prisma.stagingAccess.create({
      data: { siteId: defaultSiteId, username: "to-remove", passwordHash: "hash" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/staging-access/${entry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.stagingAccess.findUnique({ where: { id: entry.id } });
    expect(remaining).toBeNull();
  });

  it("truncates the site staging htpasswd immediately when the last credential is deleted", async () => {
    const siteBuildsDir = join(config.BUILDS_DIR, "demo");
    await mkdir(siteBuildsDir, { recursive: true });
    await writeFile(join(siteBuildsDir, ".htpasswd-staging"), "to-remove:hash\n", "utf-8");
    const entry = await app.prisma.stagingAccess.create({
      data: { siteId: defaultSiteId, username: "to-remove", passwordHash: "hash" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/staging-access/${entry.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    await expect(readFile(join(siteBuildsDir, ".htpasswd-staging"), "utf-8")).resolves.toBe("");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/staging-access/nonexistent-id",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for editor", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/staging-access/some-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
