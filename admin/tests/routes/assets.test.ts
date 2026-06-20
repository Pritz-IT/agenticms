import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { promises as fs } from "fs";
import path from "path";
import { tmpdir } from "os";

let app: FastifyInstance;
let editorToken: string;
let tempDir: string;
let assetsDir: string;
let demoSite: { id: string; key: string };
let tinyPng: Buffer;

function multipartFile(filename: string, contentType: string, body: Buffer) {
  const boundary = `----agenticms-test-${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return {
    payload,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

beforeAll(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "sf-assets-route-"));
  assetsDir = path.join(tempDir, "assets");
  (config as { ASSETS_DIR: string }).ASSETS_DIR = assetsDir;
  tinyPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 128, b: 255, alpha: 1 },
    },
  }).png().toBuffer();
  app = await buildApp({ logger: false });
  await app.ready();
  await fs.mkdir(assetsDir, { recursive: true });
});

afterAll(async () => {
  await app.close();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(assetsDir, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await app.prisma.asset.deleteMany();
  demoSite = await app.prisma.site.upsert({
    where: { key: "demo" },
    update: {
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
    create: {
      key: "demo",
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
  });
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);
});

// ---------------------------------------------------------------------------
// POST /api/sites/:siteKey/assets
// ---------------------------------------------------------------------------
describe("POST /api/sites/:siteKey/assets", () => {
  it("converts PNG editor uploads to WebP before storing the asset", async () => {
    const upload = multipartFile("Hero Image.PNG", "image/png", tinyPng);

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/assets",
      headers: {
        authorization: `Bearer ${editorToken}`,
        "content-type": upload.contentType,
      },
      payload: upload.payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      filename: "Hero Image.webp",
      mimeType: "image/webp",
    });

    const asset = await app.prisma.asset.findFirstOrThrow({ where: { siteId: demoSite.id } });
    expect(asset.filePath).toMatch(/^\/assets\/demo\/[0-9a-f-]+-Hero_Image\.webp$/);

    const diskPath = path.join(assetsDir, asset.filePath.slice("/assets/".length));
    const stored = await fs.readFile(diskPath);
    expect(stored.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(stored.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });
});

// ---------------------------------------------------------------------------
// POST /api/sites/:siteKey/assets/:id/convert-webp
// ---------------------------------------------------------------------------
describe("POST /api/sites/:siteKey/assets/:id/convert-webp", () => {
  it("converts an existing PNG asset to WebP and rewrites site references", async () => {
    const siteAssetsDir = path.join(assetsDir, "demo");
    await fs.mkdir(siteAssetsDir, { recursive: true });
    const oldFilePath = "/assets/demo/hero.png";
    const oldDiskPath = path.join(siteAssetsDir, "hero.png");
    await fs.writeFile(oldDiskPath, tinyPng);

    const layout = await app.prisma.layout.create({
      data: {
        siteId: demoSite.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: {
          "hero.image": { type: "image", initial: oldFilePath },
          "hero.title": { type: "text", initial: "Keep me" },
        },
      },
    });
    const page = await app.prisma.page.create({
      data: {
        siteId: demoSite.id,
        layoutId: layout.id,
        path: "/",
      },
    });
    await app.prisma.content.create({
      data: {
        pageId: page.id,
        key: "hero.image",
        locale: "de",
        value: oldFilePath,
        type: "image",
      },
    });
    const asset = await app.prisma.asset.create({
      data: {
        siteId: demoSite.id,
        filename: "hero.png",
        mimeType: "image/png",
        filePath: oldFilePath,
        uploadedBy: "test",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/demo/assets/${asset.id}/convert-webp`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      oldFilePath,
      newFilePath: "/assets/demo/hero.webp",
      contentUpdated: 1,
      layoutsUpdated: 1,
      asset: {
        id: asset.id,
        filename: "hero.webp",
        mimeType: "image/webp",
        filePath: "/assets/demo/hero.webp",
      },
    });

    await expect(fs.readFile(oldDiskPath)).rejects.toMatchObject({ code: "ENOENT" });
    const stored = await fs.readFile(path.join(siteAssetsDir, "hero.webp"));
    expect(stored.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(stored.subarray(8, 12).toString("ascii")).toBe("WEBP");

    await expect(app.prisma.content.findFirstOrThrow({ where: { pageId: page.id, key: "hero.image" } })).resolves.toMatchObject({
      value: "/assets/demo/hero.webp",
    });
    await expect(app.prisma.layout.findUniqueOrThrow({ where: { id: layout.id } })).resolves.toMatchObject({
      detectedKeys: {
        "hero.image": { type: "image", initial: "/assets/demo/hero.webp" },
        "hero.title": { type: "text", initial: "Keep me" },
      },
    });
  });

  it("updates duplicate asset rows that point at the same converted file", async () => {
    const siteAssetsDir = path.join(assetsDir, "demo");
    await fs.mkdir(siteAssetsDir, { recursive: true });
    const oldFilePath = "/assets/demo/duplicate-hero.png";
    const oldDiskPath = path.join(siteAssetsDir, "duplicate-hero.png");
    await fs.writeFile(oldDiskPath, tinyPng);

    const first = await app.prisma.asset.create({
      data: {
        siteId: demoSite.id,
        filename: "duplicate-hero.png",
        mimeType: "image/png",
        filePath: oldFilePath,
        uploadedBy: "first",
      },
    });
    await app.prisma.asset.create({
      data: {
        siteId: demoSite.id,
        filename: "duplicate-hero.png",
        mimeType: "image/png",
        filePath: oldFilePath,
        uploadedBy: "second",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/demo/assets/${first.id}/convert-webp`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);

    const rows = await app.prisma.asset.findMany({
      where: { siteId: demoSite.id },
      orderBy: { uploadedBy: "asc" },
    });
    expect(rows).toHaveLength(2);
    expect(rows).toEqual([
      expect.objectContaining({
        filename: "duplicate-hero.webp",
        mimeType: "image/webp",
        filePath: "/assets/demo/duplicate-hero.webp",
        uploadedBy: "first",
      }),
      expect.objectContaining({
        filename: "duplicate-hero.webp",
        mimeType: "image/webp",
        filePath: "/assets/demo/duplicate-hero.webp",
        uploadedBy: "second",
      }),
    ]);
    await expect(fs.readFile(oldDiskPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(siteAssetsDir, "duplicate-hero.webp"))).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GET /assets/*
// ---------------------------------------------------------------------------
describe("GET /assets/*", () => {
  it("serves SVG assets with nosniff and attachment disposition", async () => {
    await fs.mkdir(path.join(assetsDir, "demo"), { recursive: true });
    await fs.writeFile(path.join(assetsDir, "demo", "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const res = await app.inject({
      method: "GET",
      url: "/assets/demo/logo.svg",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });
});

// ---------------------------------------------------------------------------
// GET /api/assets
// ---------------------------------------------------------------------------
describe("GET /api/assets", () => {
  it("returns all assets ordered by uploadedAt desc", async () => {
    await app.prisma.asset.createMany({
      data: [
        {
          siteId: demoSite.id,
          filename: "first.png",
          mimeType: "image/png",
          filePath: "/assets/first.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-01-01"),
        },
        {
          siteId: demoSite.id,
          filename: "second.png",
          mimeType: "image/png",
          filePath: "/assets/second.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-02-01"),
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    // Most recent first
    expect(body[0].filename).toBe("second.png");
    expect(body[1].filename).toBe("first.png");
  });

  it("deduplicates assets by file path, keeping the newest row", async () => {
    await app.prisma.asset.createMany({
      data: [
        {
          siteId: demoSite.id,
          filename: "old.png",
          mimeType: "image/png",
          filePath: "/assets/duplicate.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-01-01"),
        },
        {
          siteId: demoSite.id,
          filename: "new.png",
          mimeType: "image/png",
          filePath: "/assets/duplicate.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-02-01"),
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({
      filename: "new.png",
      filePath: "/assets/duplicate.png",
    });
  });

  it("deduplicates byte-identical files, preferring the clean asset path", async () => {
    await fs.writeFile(path.join(assetsDir, "clean.png"), "same image");
    await fs.writeFile(path.join(assetsDir, "6ed5cbf2-6ba1-4f76-b7c0-9efe51a766a1-clean.png"), "same image");
    await app.prisma.asset.createMany({
      data: [
        {
          siteId: demoSite.id,
          filename: "clean.png",
          mimeType: "image/png",
          filePath: "/assets/clean.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-01-01"),
        },
        {
          siteId: demoSite.id,
          filename: "clean.png",
          mimeType: "image/png",
          filePath: "/assets/6ed5cbf2-6ba1-4f76-b7c0-9efe51a766a1-clean.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-02-01"),
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0]).toMatchObject({
      filename: "clean.png",
      filePath: "/assets/clean.png",
    });
  });

  it("keeps same-filename assets when their file contents differ", async () => {
    await fs.writeFile(path.join(assetsDir, "variant-a.png"), "first image");
    await fs.writeFile(path.join(assetsDir, "6ed5cbf2-6ba1-4f76-b7c0-9efe51a766a1-variant-a.png"), "second image");
    await app.prisma.asset.createMany({
      data: [
        {
          siteId: demoSite.id,
          filename: "variant-a.png",
          mimeType: "image/png",
          filePath: "/assets/variant-a.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-01-01"),
        },
        {
          siteId: demoSite.id,
          filename: "variant-a.png",
          mimeType: "image/png",
          filePath: "/assets/6ed5cbf2-6ba1-4f76-b7c0-9efe51a766a1-variant-a.png",
          uploadedBy: "a@example.com",
          uploadedAt: new Date("2024-02-01"),
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/assets",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/assets" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sites/:siteKey/assets/migrate-legacy
// ---------------------------------------------------------------------------
describe("POST /api/sites/:siteKey/assets/migrate-legacy", () => {
  it("migrates legacy asset rows for the selected site", async () => {
    await fs.writeFile(path.join(assetsDir, "hero.png"), "hero");
    const asset = await app.prisma.asset.create({
      data: {
        siteId: demoSite.id,
        filename: "hero.png",
        mimeType: "image/png",
        filePath: "/assets/hero.png",
        uploadedBy: "a@example.com",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/assets/migrate-legacy",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      scanned: 1,
      migrated: 1,
      filesCopied: 1,
      missingFiles: [],
    });
    await expect(app.prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })).resolves.toMatchObject({
      filePath: "/assets/demo/hero.png",
    });
    await expect(fs.readFile(path.join(assetsDir, "demo", "hero.png"), "utf-8")).resolves.toBe("hero");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/assets/migrate-legacy",
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/assets/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/assets/:id", () => {
  it("deletes an asset record", async () => {
    const asset = await app.prisma.asset.create({
      data: {
        siteId: demoSite.id,
        filename: "to-delete.png",
        mimeType: "image/png",
        filePath: "/assets/to-delete.png",
        uploadedBy: "a@example.com",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/assets/${asset.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.asset.findUnique({ where: { id: asset.id } });
    expect(remaining).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/assets/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/assets/some-id",
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not delete non-demo assets through the legacy route", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms",
        name: "AgentiCMS",
        domain: "agenticms.local",
        stagingDomain: "staging.agenticms.local",
        defaultLocale: "en",
      },
    });
    const asset = await app.prisma.asset.create({
      data: {
        siteId: agenticms.id,
        filename: "agenticms.png",
        mimeType: "image/png",
        filePath: "/assets/agenticms/agenticms.png",
        uploadedBy: "a@example.com",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/assets/${asset.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
    await expect(app.prisma.asset.findUnique({ where: { id: asset.id } })).resolves.toBeTruthy();
  });

  it("succeeds even when the physical file is already gone", async () => {
    const asset = await app.prisma.asset.create({
      data: {
        siteId: demoSite.id,
        filename: "ghost.png",
        mimeType: "image/png",
        filePath: `/assets/ghost-file-that-does-not-exist.png`,
        uploadedBy: "a@example.com",
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/assets/${asset.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
