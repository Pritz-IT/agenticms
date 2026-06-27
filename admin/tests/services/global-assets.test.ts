import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import {
  copyTemplateAssetsToSite,
  rewriteCopyableTemplateAssetUrls,
  syncGlobalAssetBatch,
} from "../../src/services/global-assets.js";

let app: FastifyInstance;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-global-assets-"));
  (config as { ASSETS_DIR: string }).ASSETS_DIR = join(tempDir, "assets");
  await mkdir(config.ASSETS_DIR, { recursive: true });
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await app.prisma.globalAsset.deleteMany();
  await app.prisma.asset.deleteMany();
  await app.prisma.site.deleteMany();
  await rm(config.ASSETS_DIR, { recursive: true, force: true });
  await mkdir(config.ASSETS_DIR, { recursive: true });
});

describe("global assets service", () => {
  it("syncGlobalAssetBatch registers shared and copyable assets", async () => {
    const result = await syncGlobalAssetBatch(app, [
      {
        path: "shared/brands/demo-brand/logo.svg",
        base64: Buffer.from("<svg />").toString("base64"),
      },
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("webp").toString("base64"),
      },
    ]);

    expect(result.files).toEqual([
      { path: "shared/brands/demo-brand/logo.svg", status: "registered" },
      { path: "templates/sample-template/hero.webp", status: "registered" },
    ]);
    expect(result.assets).toEqual([
      {
        key: "shared/brands/demo-brand/logo.svg",
        mode: "shared",
        templateFolder: null,
        filePath: "/assets/_global/shared/brands/demo-brand/logo.svg",
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: "registered",
      },
      {
        key: "templates/sample-template/hero.webp",
        mode: "copyable",
        templateFolder: "sample-template",
        filePath: "/assets/_global/templates/sample-template/hero.webp",
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: "registered",
      },
    ]);

    const rows = await app.prisma.globalAsset.findMany({ orderBy: { key: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: "shared/brands/demo-brand/logo.svg",
      mode: "shared",
      templateFolder: null,
      filename: "logo.svg",
      mimeType: "image/svg+xml",
      filePath: "/assets/_global/shared/brands/demo-brand/logo.svg",
    });
    expect(rows[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[1]).toMatchObject({
      key: "templates/sample-template/hero.webp",
      mode: "copyable",
      templateFolder: "sample-template",
      filename: "hero.webp",
      mimeType: "image/webp",
      filePath: "/assets/_global/templates/sample-template/hero.webp",
    });
    expect(rows[1].sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects traversal paths and unsupported extensions", async () => {
    await expect(syncGlobalAssetBatch(app, [
      { path: "../escape.png", base64: Buffer.from("x").toString("base64") },
    ])).rejects.toThrow("path");

    await expect(syncGlobalAssetBatch(app, [
      { path: "shared/docs/readme.txt", base64: Buffer.from("x").toString("base64") },
    ])).rejects.toThrow("unsupported file extension");

    await expect(syncGlobalAssetBatch(app, [
      { path: "other/hero.png", base64: Buffer.from("x").toString("base64") },
    ])).rejects.toThrow("global asset path");
  });

  it("rejects files above the 25 MB decoded size limit", async () => {
    await expect(syncGlobalAssetBatch(app, [
      {
        path: "shared/oversized.png",
        base64: Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64"),
      },
    ])).rejects.toThrow("25 MB limit");
  });

  it("accepts a self-hosted video within the 25 MB per-file limit", async () => {
    const result = await syncGlobalAssetBatch(app, [
      {
        path: "shared/clips/hero.mp4",
        base64: Buffer.alloc(14 * 1024 * 1024).toString("base64"),
      },
    ]);
    expect(result.files).toEqual([
      { path: "shared/clips/hero.mp4", status: "registered" },
    ]);
    const rows = await app.prisma.globalAsset.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ filename: "hero.mp4", mimeType: "video/mp4" });
  });

  it("rejects batches above the 25 MB decoded size limit", async () => {
    const nineMegabytes = Buffer.alloc(9 * 1024 * 1024).toString("base64");

    await expect(syncGlobalAssetBatch(app, [
      { path: "shared/batch-a.png", base64: nineMegabytes },
      { path: "shared/batch-b.png", base64: nineMegabytes },
      { path: "shared/batch-c.png", base64: nineMegabytes },
    ])).rejects.toThrow("25 MB limit");
  });

  it("copyTemplateAssetsToSite copies copyable template assets and links site asset rows", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });

    await syncGlobalAssetBatch(app, [
      {
        path: "shared/brands/demo-brand/logo.svg",
        base64: Buffer.from("<svg />").toString("base64"),
      },
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("webp").toString("base64"),
      },
      {
        path: "templates/sample-template/gallery/detail.png",
        base64: Buffer.from("png").toString("base64"),
      },
    ]);

    const result = await copyTemplateAssetsToSite(app, site, "sample-template");

    expect(result.files).toEqual([
      { sourcePath: "templates/sample-template/gallery/detail.png", destinationPath: "gallery/detail.png", status: "copied" },
      { sourcePath: "templates/sample-template/hero.webp", destinationPath: "hero.webp", status: "copied" },
    ]);
    expect(result.assetSync.created).toBe(2);
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).resolves.toBe("webp");

    const rows = await app.prisma.asset.findMany({ where: { siteId: site.id }, orderBy: { filePath: "asc" } });
    expect(rows.map((row) => row.filePath)).toEqual([
      "/assets/sample/gallery/detail.png",
      "/assets/sample/hero.webp",
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        filePath: "/assets/sample/hero.webp",
        globalAssetId: expect.any(String),
        globalAssetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]));
    expect(rows.every((row) => row.globalAssetId && row.globalAssetHash)).toBe(true);
  });

  it("copyTemplateAssetsToSite refreshes files linked to the same global asset after source changes", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero-v1").toString("base64"),
      },
    ]);
    const firstGlobalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });
    await copyTemplateAssetsToSite(app, site, "sample-template");
    const firstRow = await app.prisma.asset.findFirstOrThrow({
      where: { siteId: site.id, filePath: "/assets/sample/hero.webp" },
    });

    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero-v2").toString("base64"),
      },
    ]);
    const refreshedGlobalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });

    const result = await copyTemplateAssetsToSite(app, site, "sample-template");

    expect(refreshedGlobalAsset.id).toBe(firstGlobalAsset.id);
    expect(refreshedGlobalAsset.sourceHash).not.toBe(firstGlobalAsset.sourceHash);
    expect(result.files).toEqual([
      { sourcePath: "templates/sample-template/hero.webp", destinationPath: "hero.webp", status: "copied" },
    ]);
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).resolves.toBe("template-hero-v2");
    const row = await app.prisma.asset.findFirstOrThrow({
      where: { siteId: site.id, filePath: "/assets/sample/hero.webp" },
    });
    expect(row.id).toBe(firstRow.id);
    expect(row.globalAssetId).toBe(refreshedGlobalAsset.id);
    expect(row.globalAssetHash).toBe(refreshedGlobalAsset.sourceHash);
  });

  it("copyTemplateAssetsToSite rejects unrelated existing site-owned asset rows", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    await app.prisma.asset.create({
      data: {
        siteId: site.id,
        filename: "hero.webp",
        mimeType: "image/webp",
        filePath: "/assets/sample/hero.webp",
        uploadedBy: "site-owner",
      },
    });

    await expect(copyTemplateAssetsToSite(app, site, "sample-template")).rejects.toThrow("Destination asset already exists");
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).rejects.toThrow();
  });

  it("copyTemplateAssetsToSite rejects untracked existing destination files", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    await mkdir(join(config.ASSETS_DIR, "sample"), { recursive: true });
    await writeFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "site-owned");

    await expect(copyTemplateAssetsToSite(app, site, "sample-template")).rejects.toThrow("Destination asset file already exists");
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).resolves.toBe("site-owned");
    const row = await app.prisma.asset.findFirst({
      where: { siteId: site.id, filePath: "/assets/sample/hero.webp" },
    });
    expect(row).toBeNull();
  });

  it("copyTemplateAssetsToSite adopts an untracked destination file when it already matches the global asset", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalAssetBatch(app, [
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("template-hero").toString("base64"),
      },
    ]);
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });
    await mkdir(join(config.ASSETS_DIR, "sample"), { recursive: true });
    await writeFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "template-hero");

    const result = await copyTemplateAssetsToSite(app, site, "sample-template");

    expect(result.files).toEqual([
      { sourcePath: "templates/sample-template/hero.webp", destinationPath: "hero.webp", status: "skipped" },
    ]);
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).resolves.toBe("template-hero");
    const row = await app.prisma.asset.findFirstOrThrow({
      where: { siteId: site.id, filePath: "/assets/sample/hero.webp" },
    });
    expect(row.globalAssetId).toBe(globalAsset.id);
    expect(row.globalAssetHash).toBe(globalAsset.sourceHash);
  });

  it("copyTemplateAssetsToSite rejects malformed stored template asset paths", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await app.prisma.globalAsset.create({
      data: {
        key: "templates/sample-template/../escape.png",
        mode: "copyable",
        templateFolder: "sample-template",
        filename: "escape.png",
        mimeType: "image/png",
        filePath: "/assets/_global/templates/sample-template/../escape.png",
        sourceHash: "malformed",
      },
    });

    await expect(copyTemplateAssetsToSite(app, site, "sample-template")).rejects.toThrow("invalid path segment");
  });

  it("rewrites copyable template URLs to copied site URLs", async () => {
    const content = `
      <img src="/assets/_global/templates/sample-template/hero.webp" />
      <img src="/assets/_global/shared/brands/demo-brand/logo.svg" />
    `;

    expect(rewriteCopyableTemplateAssetUrls(content, "sample", "sample-template")).toContain(
      "/assets/sample/hero.webp"
    );
    expect(rewriteCopyableTemplateAssetUrls(content, "sample", "sample-template")).toContain(
      "/assets/_global/shared/brands/demo-brand/logo.svg"
    );
  });
});
