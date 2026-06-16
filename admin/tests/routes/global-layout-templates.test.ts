import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { syncGlobalLayoutBatch } from "../../src/services/global-layout-templates.js";
import { syncGlobalAssetBatch } from "../../src/services/global-assets.js";

let app: FastifyInstance;
let tempDir: string;
let adminToken: string;
let editorToken: string;
let userCounter = 0;

function uniqueEmail(prefix: string): string {
  userCounter += 1;
  return `${prefix}-${userCounter}@example.com`;
}

async function syncHomeTemplate(label: string) {
  await syncGlobalLayoutBatch(app, [{
    path: "sample-template/Home.tsx",
    content: `
      export const keys = { "hero.title": { type: "text", initial: "${label}" } };
      export default function Home() { return <main>${label}</main>; }
    `,
  }]);
  return app.prisma.globalLayoutTemplate.findFirstOrThrow();
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-global-routes-"));
  (config as { LAYOUTS_DIR: string; COMPILED_LAYOUTS_DIR: string; ASSETS_DIR: string }).LAYOUTS_DIR = join(tempDir, "layouts");
  (config as { COMPILED_LAYOUTS_DIR: string }).COMPILED_LAYOUTS_DIR = join(tempDir, "layout-modules");
  (config as { ASSETS_DIR: string }).ASSETS_DIR = join(tempDir, "assets");
  await mkdir(config.LAYOUTS_DIR, { recursive: true });
  await mkdir(config.ASSETS_DIR, { recursive: true });
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.asset.deleteMany();
  await app.prisma.globalAsset.deleteMany();
  await app.prisma.globalLayoutTemplate.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  await rm(config.LAYOUTS_DIR, { recursive: true, force: true });
  await rm(config.COMPILED_LAYOUTS_DIR, { recursive: true, force: true });
  await rm(config.ASSETS_DIR, { recursive: true, force: true });
  await mkdir(config.LAYOUTS_DIR, { recursive: true });
  await mkdir(config.ASSETS_DIR, { recursive: true });

  await app.prisma.site.create({
    data: {
      key: "sample",
      name: "Sample Template",
      domain: "ai.local",
      stagingDomain: "staging-ai.local",
      defaultLocale: "de",
    },
  });
  const { user: admin } = await createTestUser(app, { role: "admin", email: uniqueEmail("admin-global") });
  const { user: editor } = await createTestUser(app, { role: "editor", email: uniqueEmail("editor-global") });
  adminToken = getAccessToken(admin);
  editorToken = getAccessToken(editor);
});

describe("global layout template routes", () => {
  it("lists templates and creates a site copy with global metadata", async () => {
    const template = await syncHomeTemplate("AI");

    const list = await app.inject({
      method: "GET",
      url: "/api/global-layout-templates",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0]).toMatchObject({ id: template.id, key: "sample-template/Home.tsx", name: "Home" });

    const copy = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-layout-templates/${template.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { destinationPath: "Home.tsx" },
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({
      globalTemplateId: template.id,
      globalTemplateHash: template.sourceHash,
      filePath: "Home.tsx",
    });

    const layouts = await app.inject({
      method: "GET",
      url: "/api/sites/sample/layouts",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(layouts.statusCode).toBe(200);
    expect(layouts.json()[0].globalTemplate).toMatchObject({
      id: template.id,
      key: "sample-template/Home.tsx",
      name: "Home",
      differsFromSiteCopy: false,
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/sites/sample/layouts/${copy.json().id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().globalTemplate).toMatchObject({
      id: template.id,
      key: "sample-template/Home.tsx",
      name: "Home",
      differsFromSiteCopy: false,
    });
  });

  it("blocks editor copy from global", async () => {
    const template = await syncHomeTemplate("AI");

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-layout-templates/${template.id}/copy`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { destinationPath: "Home.tsx" },
    });

    expect(res.statusCode).toBe(403);
  });

  it("copies and rewrites copyable template asset URLs when copying from global", async () => {
    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/Hero.tsx",
        content: `
          export function Hero() {
            return <section style={{ backgroundImage: "url(/assets/_global/templates/sample-template/hero.webp)" }} />;
          }
        `,
      },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { Hero } from "./components/Hero";
          export const keys = {
            "hero.image": { type: "image", initial: "/assets/_global/templates/sample-template/hero.webp" },
            "brand.logo": { type: "image", initial: "/assets/_global/shared/brands/demo-brand/logo.svg" }
          };
          export default function Home() {
            return <main><img src="/assets/_global/shared/brands/demo-brand/logo.svg" /><Hero /></main>;
          }
        `,
      },
    ]);
    await syncGlobalAssetBatch(app, [
      {
        path: "shared/brands/demo-brand/logo.svg",
        base64: Buffer.from("<svg />").toString("base64"),
      },
      {
        path: "templates/sample-template/hero.webp",
        base64: Buffer.from("hero-webp").toString("base64"),
      },
    ]);
    const template = await app.prisma.globalLayoutTemplate.findFirstOrThrow();

    const copy = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-layout-templates/${template.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { destinationPath: "Home.tsx" },
    });

    expect(copy.statusCode).toBe(201);
    expect(copy.json().detectedKeys).toMatchObject({
      "hero.image": { type: "image", initial: "/assets/sample/hero.webp" },
      "brand.logo": { type: "image", initial: "/assets/_global/shared/brands/demo-brand/logo.svg" },
    });
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).resolves.toBe("hero-webp");
    await expect(readFile(join(config.LAYOUTS_DIR, "sample", "components", "Hero.tsx"), "utf-8")).resolves.toContain("/assets/sample/hero.webp");
  });

  it("returns conflict when copying over an unrelated destination layout", async () => {
    const template = await syncHomeTemplate("AI");
    const site = await app.prisma.site.findUniqueOrThrow({ where: { key: "sample" } });
    await app.prisma.layout.create({
      data: { siteId: site.id, name: "Existing", filePath: "Home.tsx", detectedKeys: {} },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-layout-templates/${template.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { destinationPath: "Home.tsx" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("marks linked layouts modified after the global source changes", async () => {
    const template = await syncHomeTemplate("AI v1");
    const created = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-layout-templates/${template.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { destinationPath: "Home.tsx" },
    });
    expect(created.statusCode).toBe(201);

    await syncHomeTemplate("AI v2");

    const layouts = await app.inject({
      method: "GET",
      url: "/api/sites/sample/layouts",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(layouts.statusCode).toBe(200);
    expect(layouts.json()[0].globalTemplate.differsFromSiteCopy).toBe(true);
  });

  it("copies current global source over a modified site copy", async () => {
    const template = await syncHomeTemplate("AI v1");
    const created = await app.inject({
      method: "POST",
      url: `/api/sites/sample/global-layout-templates/${template.id}/copy`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { destinationPath: "Home.tsx" },
    });
    expect(created.statusCode).toBe(201);

    await syncHomeTemplate("AI v2");

    const before = await app.inject({
      method: "GET",
      url: "/api/sites/sample/layouts",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(before.statusCode).toBe(200);
    expect(before.json()[0].globalTemplate.differsFromSiteCopy).toBe(true);

    const copy = await app.inject({
      method: "POST",
      url: `/api/sites/sample/layouts/${created.json().id}/copy-from-global`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(copy.statusCode).toBe(200);
    expect(copy.json().globalTemplateHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(readFile(join(config.LAYOUTS_DIR, "sample", "Home.tsx"), "utf-8")).resolves.toContain("AI v2");

    const after = await app.inject({
      method: "GET",
      url: "/api/sites/sample/layouts",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()[0].globalTemplate.differsFromSiteCopy).toBe(false);
  });
});
