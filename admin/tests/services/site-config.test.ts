import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { buildSiteConfig } from "../../src/services/website-build/site-config.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.asset.deleteMany();
  await app.prisma.site.deleteMany();
});

describe("buildSiteConfig", () => {
  it.each(["{invalid", '{"pageSize":0}'])("names the page and field for malformed stored bloglist %s", async (value) => {
    const site = await app.prisma.site.create({ data: { key: "demo", name: "Demo", domain: "demo.local", stagingDomain: "staging.demo.local", defaultLocale: "de" } });
    const layout = await app.prisma.layout.create({ data: { siteId: site.id, name: "News", filePath: "News.tsx", detectedKeys: { articles: { type: "bloglist" } } } });
    await app.prisma.page.create({ data: {
      siteId: site.id, path: "/news", isPublished: true, layoutId: layout.id,
      contents: { create: { key: "articles", locale: "de", type: "bloglist", value } },
    } });
    await expect(buildSiteConfig(app.prisma, "demo", "staging")).rejects.toThrow(/Page \/news.*articles.*(?:Bloglist|pageSize)/);
  });

  it("returns only assets for the selected site", async () => {
    const demo = await app.prisma.site.create({
      data: { key: "demo", name: "Demo Site", domain: "demo.local", stagingDomain: "staging.demo.local", defaultLocale: "de" },
    });
    const agenticms = await app.prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await app.prisma.asset.createMany({
      data: [
        { siteId: demo.id, filename: "logo.png", mimeType: "image/png", filePath: "/assets/demo/logo.png", uploadedBy: "test" },
        { siteId: agenticms.id, filename: "logo.png", mimeType: "image/png", filePath: "/assets/agenticms/logo.png", uploadedBy: "test" },
      ],
    });

    const config = await buildSiteConfig(app.prisma, "agenticms", "production");

    expect(config.settings?.id).toBe(agenticms.id);
    expect(config.buildTarget).toBe("production");
    expect(config.posts).toEqual([]);
    expect(config.blogLists).toEqual({});
    expect(config.assets).toEqual([
      expect.objectContaining({ filePath: "/assets/agenticms/logo.png" }),
    ]);
  });
});
