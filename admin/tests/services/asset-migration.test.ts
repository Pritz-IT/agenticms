import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../src/app.js";
import { migrateLegacyAssetsForSite } from "../../src/services/asset-migration.js";

let app: FastifyInstance;
let dir: string;

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
  await app.prisma.asset.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();
  dir = await mkdtemp(join(tmpdir(), "sf-asset-migration-"));
});

describe("migrateLegacyAssetsForSite", () => {
  it("moves legacy asset paths into a site folder and rewrites site references", async () => {
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(join(dir, "hero.png"), "hero");
    await writeFile(join(dir, "nested", "case.webp"), "case");

    const site = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    const otherSite = await app.prisma.site.create({
      data: {
        key: "asset-migration-alt",
        name: "Asset Migration Alt",
        domain: "asset-migration-alt.local",
        stagingDomain: "staging-asset-migration-alt.local",
        defaultLocale: "en",
      },
    });
    const layout = await app.prisma.layout.create({
      data: {
        siteId: site.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: {
          "hero.image": { type: "image", initial: "/assets/hero.png" },
          "case.image": { type: "image", initial: "/assets/nested/case.webp" },
        },
      },
    });
    const otherLayout = await app.prisma.layout.create({
      data: {
        siteId: otherSite.id,
        name: "Home",
        filePath: "Home.tsx",
        detectedKeys: { "hero.image": { type: "image", initial: "/assets/hero.png" } },
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: site.id, path: "/", layoutId: layout.id },
    });
    const otherPage = await app.prisma.page.create({
      data: { siteId: otherSite.id, path: "/", layoutId: otherLayout.id },
    });
    await app.prisma.content.createMany({
      data: [
        { pageId: page.id, key: "hero.image", locale: "de", value: "/assets/hero.png", type: "image" },
        { pageId: page.id, key: "case.image", locale: "de", value: "/assets/nested/case.webp", type: "image" },
        { pageId: otherPage.id, key: "hero.image", locale: "en", value: "/assets/hero.png", type: "image" },
      ],
    });
    await app.prisma.asset.createMany({
      data: [
        {
          siteId: site.id,
          filename: "hero.png",
          mimeType: "image/png",
          filePath: "/assets/hero.png",
          uploadedBy: "system",
        },
        {
          siteId: site.id,
          filename: "case.webp",
          mimeType: "image/webp",
          filePath: "/assets/nested/case.webp",
          uploadedBy: "system",
        },
        {
          siteId: otherSite.id,
          filename: "hero.png",
          mimeType: "image/png",
          filePath: "/assets/hero.png",
          uploadedBy: "system",
        },
      ],
    });

    const result = await migrateLegacyAssetsForSite(app.prisma, dir, site);

    expect(result).toMatchObject({
      scanned: 2,
      migrated: 2,
      filesCopied: 2,
      filesAlreadyPresent: 0,
      contentUpdated: 2,
      layoutsUpdated: 1,
      missingFiles: [],
    });
    await expect(readFile(join(dir, "demo", "hero.png"), "utf-8")).resolves.toBe("hero");
    await expect(readFile(join(dir, "demo", "nested", "case.webp"), "utf-8")).resolves.toBe("case");

    await expect(app.prisma.asset.findMany({ where: { siteId: site.id }, orderBy: { filePath: "asc" } })).resolves.toMatchObject([
      { filePath: "/assets/demo/hero.png" },
      { filePath: "/assets/demo/nested/case.webp" },
    ]);
    await expect(app.prisma.content.findMany({ where: { pageId: page.id }, orderBy: { key: "asc" } })).resolves.toMatchObject([
      { value: "/assets/demo/nested/case.webp" },
      { value: "/assets/demo/hero.png" },
    ]);
    await expect(app.prisma.layout.findUniqueOrThrow({ where: { id: layout.id } })).resolves.toMatchObject({
      detectedKeys: {
        "hero.image": { initial: "/assets/demo/hero.png" },
        "case.image": { initial: "/assets/demo/nested/case.webp" },
      },
    });

    await expect(app.prisma.asset.findMany({ where: { siteId: otherSite.id } })).resolves.toMatchObject([
      { filePath: "/assets/hero.png" },
    ]);
    await expect(app.prisma.content.findMany({ where: { pageId: otherPage.id } })).resolves.toMatchObject([
      { value: "/assets/hero.png" },
    ]);

    await rm(dir, { recursive: true, force: true });
  });

  it("uses already synced site files and reports missing legacy files", async () => {
    await mkdir(join(dir, "demo"), { recursive: true });
    await writeFile(join(dir, "demo", "present.png"), "present");

    const site = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    await app.prisma.asset.createMany({
      data: [
        {
          siteId: site.id,
          filename: "present.png",
          mimeType: "image/png",
          filePath: "/assets/present.png",
          uploadedBy: "system",
        },
        {
          siteId: site.id,
          filename: "missing.png",
          mimeType: "image/png",
          filePath: "/assets/missing.png",
          uploadedBy: "system",
        },
      ],
    });

    const result = await migrateLegacyAssetsForSite(app.prisma, dir, site);

    expect(result).toMatchObject({
      scanned: 2,
      migrated: 1,
      filesCopied: 0,
      filesAlreadyPresent: 1,
      missingFiles: ["/assets/missing.png"],
    });
    await expect(app.prisma.asset.findMany({ where: { siteId: site.id }, orderBy: { filename: "asc" } })).resolves.toMatchObject([
      { filename: "missing.png", filePath: "/assets/missing.png" },
      { filename: "present.png", filePath: "/assets/demo/present.png" },
    ]);

    await rm(dir, { recursive: true, force: true });
  });
});
