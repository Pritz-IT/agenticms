import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
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
  await app.prisma.asset.deleteMany();
  await app.prisma.globalAsset.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user } = await createTestUser(app, { role: "admin" });
  token = getAccessToken(user);
});

describe("site assets", () => {
  it("returns only active-site assets and stores site-keyed asset paths", async () => {
    const demo = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms",
        name: "AgentiCMS",
        domain: "agenticms.local",
        stagingDomain: "staging.agenticms.local",
        defaultLocale: "en",
      },
    });

    await app.prisma.asset.create({
      data: {
        siteId: demo.id,
        filename: "logo.png",
        mimeType: "image/png",
        filePath: "/assets/demo/logo.png",
        uploadedBy: "test",
      },
    });
    await app.prisma.asset.create({
      data: {
        siteId: agenticms.id,
        filename: "logo.png",
        mimeType: "image/png",
        filePath: "/assets/agenticms/logo.png",
        uploadedBy: "test",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/assets",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].filePath).toBe("/assets/demo/logo.png");
  });

  it("returns duplicate site-owned asset rows even when files have identical content", async () => {
    const demo = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    const siteAssetsDir = path.join(config.ASSETS_DIR, "demo");
    await mkdir(siteAssetsDir, { recursive: true });
    await writeFile(path.join(siteAssetsDir, "duplicate-a.png"), "same-image-bytes");
    await writeFile(path.join(siteAssetsDir, "duplicate-b.png"), "same-image-bytes");

    const first = await app.prisma.asset.create({
      data: {
        siteId: demo.id,
        filename: "duplicate-a.png",
        mimeType: "image/png",
        filePath: "/assets/demo/duplicate-a.png",
        uploadedBy: "test",
      },
    });
    const second = await app.prisma.asset.create({
      data: {
        siteId: demo.id,
        filename: "duplicate-b.png",
        mimeType: "image/png",
        filePath: "/assets/demo/duplicate-b.png",
        uploadedBy: "test",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/assets",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, filePath: "/assets/demo/duplicate-a.png" }),
        expect.objectContaining({ id: second.id, filePath: "/assets/demo/duplicate-b.png" }),
      ])
    );
    expect(res.json()).toHaveLength(2);
  });

  it("deletes only assets that belong to the selected site", async () => {
    const demo = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms",
        name: "AgentiCMS",
        domain: "agenticms.local",
        stagingDomain: "staging.agenticms.local",
        defaultLocale: "en",
      },
    });

    const demoAsset = await app.prisma.asset.create({
      data: {
        siteId: demo.id,
        filename: "logo.png",
        mimeType: "image/png",
        filePath: "/assets/demo/logo.png",
        uploadedBy: "test",
      },
    });
    const agenticmsAsset = await app.prisma.asset.create({
      data: {
        siteId: agenticms.id,
        filename: "logo.png",
        mimeType: "image/png",
        filePath: "/assets/agenticms/logo.png",
        uploadedBy: "test",
      },
    });

    const crossSite = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/assets/${agenticmsAsset.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(crossSite.statusCode).toBe(404);
    await expect(app.prisma.asset.findUnique({ where: { id: agenticmsAsset.id } })).resolves.toBeTruthy();

    const ownSite = await app.inject({
      method: "DELETE",
      url: `/api/sites/demo/assets/${demoAsset.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ownSite.statusCode).toBe(200);
    expect(ownSite.json()).toEqual({ ok: true });
    await expect(app.prisma.asset.findUnique({ where: { id: demoAsset.id } })).resolves.toBeNull();
  });

  it("returns site assets plus read-only shared globals in the editor library", async () => {
    const demo = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    await app.prisma.asset.create({
      data: {
        siteId: demo.id,
        filename: "hero.png",
        mimeType: "image/png",
        filePath: "/assets/demo/hero.png",
        uploadedBy: "test",
      },
    });
    const shared = await app.prisma.globalAsset.create({
      data: {
        key: "shared/badge.svg",
        mode: "shared",
        filename: "badge.svg",
        mimeType: "image/svg+xml",
        filePath: "/assets/_global/shared/badge.svg",
        sourceHash: "shared-source-hash",
      },
    });
    await app.prisma.globalAsset.create({
      data: {
        key: "templates/default/hero.png",
        mode: "copyable",
        templateFolder: "default",
        filename: "hero.png",
        mimeType: "image/png",
        filePath: "/assets/_global/templates/default/hero.png",
        sourceHash: "copyable-source-hash",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/assets/library",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        filename: "hero.png",
        filePath: "/assets/demo/hero.png",
        scope: "site",
        deletable: true,
      }),
      expect.objectContaining({
        id: shared.id,
        filename: "badge.svg",
        filePath: "/assets/_global/shared/badge.svg",
        uploadedBy: "global",
        scope: "global-shared",
        deletable: false,
      }),
    ]);
    expect(res.json()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: "/assets/_global/templates/default/hero.png" }),
      ])
    );
  });

  it("marks copied site assets when the linked global asset has changed", async () => {
    const demo = await app.prisma.site.create({
      data: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.local",
        stagingDomain: "staging.demo.local",
        defaultLocale: "de",
      },
    });
    const globalAsset = await app.prisma.globalAsset.create({
      data: {
        key: "templates/default/logo.png",
        mode: "copyable",
        templateFolder: "default",
        filename: "logo.png",
        mimeType: "image/png",
        filePath: "/assets/_global/templates/default/logo.png",
        sourceHash: "new-source-hash",
      },
    });
    await app.prisma.asset.create({
      data: {
        siteId: demo.id,
        globalAssetId: globalAsset.id,
        globalAssetHash: "old-source-hash",
        filename: "logo.png",
        mimeType: "image/png",
        filePath: "/assets/demo/logo.png",
        uploadedBy: "test",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/assets",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        globalAssetId: globalAsset.id,
        globalAssetHash: "old-source-hash",
        globalAsset: {
          id: globalAsset.id,
          key: "templates/default/logo.png",
          mode: "copyable",
          filePath: "/assets/_global/templates/default/logo.png",
          sourceHash: "new-source-hash",
        },
        differsFromGlobal: true,
      }),
    ]);
  });
});
