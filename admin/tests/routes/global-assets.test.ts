import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { syncGlobalAssetBatch } from "../../src/services/global-assets.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let tempDir: string;
let assetsDir: string;
let adminToken: string;
let editorToken: string;
let userCounter = 0;

function uniqueEmail(prefix: string): string {
  userCounter += 1;
  return `${prefix}-${userCounter}@example.com`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-global-assets-routes-"));
  assetsDir = join(tempDir, "assets");
  (config as { ASSETS_DIR: string }).ASSETS_DIR = assetsDir;
  await mkdir(assetsDir, { recursive: true });
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
  await app.prisma.asset.deleteMany();
  await app.prisma.globalAsset.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  await app.prisma.site.create({
    data: {
      key: "sample",
      name: "Sample Template",
      domain: "ai.local",
      stagingDomain: "staging-ai.local",
      defaultLocale: "de",
    },
  });

  const { user: admin } = await createTestUser(app, { role: "admin", email: uniqueEmail("admin") });
  const { user: editor } = await createTestUser(app, { role: "editor", email: uniqueEmail("editor") });
  adminToken = getAccessToken(admin);
  editorToken = getAccessToken(editor);
});

describe("global assets routes", () => {
  it("lists global assets for editors", async () => {
    await syncGlobalAssetBatch(app, [
      {
        path: "shared/brands/demo-brand/logo.svg",
        base64: Buffer.from("<svg />").toString("base64"),
      },
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("webp").toString("base64"),
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/global-assets",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "shared/brands/demo-brand/logo.svg",
        mode: "shared",
        filePath: "/assets/_global/shared/brands/demo-brand/logo.svg",
      }),
      expect.objectContaining({
        key: "templates/sample-template/hero.webp",
        mode: "copyable",
        templateFolder: "sample-template",
        filePath: "/assets/_global/templates/sample-template/hero.webp",
      }),
    ]));
  });

  it("copies a copyable global asset into a site for admins", async () => {
    const syncResult = await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: syncResult.assets[0]!.key },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${globalAsset.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      filePath: "/assets/sample/hero.webp",
      filename: "hero.webp",
      mimeType: "image/webp",
      globalAssetId: globalAsset.id,
      globalAssetHash: globalAsset.sourceHash,
      copyStatus: "copied",
    });
    await expect(readFile(join(assetsDir, "sample", "hero.webp"), "utf-8")).resolves.toBe("template-hero");

    const row = await app.prisma.asset.findFirstOrThrow({
      where: { filePath: "/assets/sample/hero.webp" },
    });
    expect(row.globalAssetId).toBe(globalAsset.id);
    expect(row.globalAssetHash).toBe(globalAsset.sourceHash);
  });

  it("rejects copying over an existing site-owned asset", async () => {
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    const site = await app.prisma.site.findUniqueOrThrow({ where: { key: "sample" } });
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });
    await mkdir(join(assetsDir, "sample"), { recursive: true });
    await writeFile(join(assetsDir, "sample", "hero.webp"), "site-custom");
    await app.prisma.asset.create({
      data: {
        siteId: site.id,
        filename: "hero.webp",
        mimeType: "image/webp",
        filePath: "/assets/sample/hero.webp",
        uploadedBy: "test",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${globalAsset.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(409);
    await expect(readFile(join(assetsDir, "sample", "hero.webp"), "utf-8")).resolves.toBe("site-custom");
  });

  it("rejects copying over an untracked destination file", async () => {
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });
    await mkdir(join(assetsDir, "sample"), { recursive: true });
    await writeFile(join(assetsDir, "sample", "hero.webp"), "disk-custom");

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${globalAsset.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(409);
    await expect(readFile(join(assetsDir, "sample", "hero.webp"), "utf-8")).resolves.toBe("disk-custom");
  });

  it("refreshes an existing linked asset for the same global asset", async () => {
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("first-hero").toString("base64"),
      },
    ]);
    const firstGlobalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });
    const firstCopy = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${firstGlobalAsset.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(firstCopy.statusCode).toBe(201);

    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("second-hero").toString("base64"),
      },
    ]);
    const refreshedGlobalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${refreshedGlobalAsset.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      filePath: "/assets/sample/hero.webp",
      globalAssetId: refreshedGlobalAsset.id,
      globalAssetHash: refreshedGlobalAsset.sourceHash,
      copyStatus: "refreshed",
    });
    expect(refreshedGlobalAsset.id).toBe(firstGlobalAsset.id);
    expect(refreshedGlobalAsset.sourceHash).not.toBe(firstGlobalAsset.sourceHash);
    await expect(readFile(join(assetsDir, "sample", "hero.webp"), "utf-8")).resolves.toBe("second-hero");

    const row = await app.prisma.asset.findFirstOrThrow({
      where: { filePath: "/assets/sample/hero.webp" },
    });
    expect(row.globalAssetHash).toBe(refreshedGlobalAsset.sourceHash);
  });

  it("rejects editor copy attempts", async () => {
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${globalAsset.id}/copy`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(403);
    await expect(fileExists(join(assetsDir, "sample", "hero.webp"))).resolves.toBe(false);
  });

  it("rejects copying shared global assets into a site", async () => {
    await syncGlobalAssetBatch(app, [
      {
        path: "shared/brands/demo-brand/logo.svg",
        base64: Buffer.from("<svg />").toString("base64"),
      },
    ]);
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "shared/brands/demo-brand/logo.svg" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-assets/${globalAsset.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
  });
});
