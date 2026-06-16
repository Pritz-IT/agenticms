import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import {
  copyGlobalTemplateToSite,
  copyLinkedGlobalTemplateToLayout,
  syncGlobalLayoutBatch,
} from "../../src/services/global-layout-templates.js";
import { syncGlobalAssetBatch } from "../../src/services/global-assets.js";

let app: FastifyInstance;
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-global-layouts-"));
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
  await rm(config.LAYOUTS_DIR, { recursive: true, force: true });
  await rm(config.ASSETS_DIR, { recursive: true, force: true });
  await mkdir(config.LAYOUTS_DIR, { recursive: true });
  await mkdir(config.ASSETS_DIR, { recursive: true });
});

describe("global layout templates service", () => {
  it("syncs a root template and ignores helper-only rows", async () => {
    const result = await syncGlobalLayoutBatch(app, [
      { path: "sample-template/components/tokens.ts", content: "export const label = 'AI';" },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { label } from "./components/tokens";
          export const keys = { "hero.title": { type: "text", initial: "AI" } };
          export default function Home() { return <main>{label}</main>; }
        `,
      },
    ]);

    expect(result.files).toEqual([
      { path: "sample-template/components/tokens.ts", status: "written" },
      { path: "sample-template/Home.tsx", status: "registered" },
    ]);

    const templates = await app.prisma.globalLayoutTemplate.findMany();
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      key: "sample-template/Home.tsx",
      filePath: "sample-template/Home.tsx",
      name: "Home",
    });
    expect(templates[0].sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("re-hashes an existing root template after helper-only sync", async () => {
    await syncGlobalLayoutBatch(app, [
      { path: "sample-template/components/tokens.ts", content: "export const label = 'first';" },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { label } from "./components/tokens";
          export const keys = { "hero.title": { type: "text", initial: "AI" } };
          export default function Home() { return <main>{label}</main>; }
        `,
      },
    ]);
    const first = await app.prisma.globalLayoutTemplate.findFirstOrThrow();

    const result = await syncGlobalLayoutBatch(app, [
      { path: "sample-template/components/tokens.ts", content: "export const label = 'second';" },
    ]);
    const second = await app.prisma.globalLayoutTemplate.findFirstOrThrow();

    expect(result.templates).toEqual([{ key: "sample-template/Home.tsx", status: "registered" }]);
    expect(second.sourceHash).not.toBe(first.sourceHash);
  });

  it("rejects traversal paths", async () => {
    await expect(syncGlobalLayoutBatch(app, [{ path: "../escape.tsx", content: "x" }])).rejects.toThrow("path");
  });

  it("copies a global template into a site and links hashes", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });

    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/tokens.ts",
        content: "export const label = 'AI';",
      },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { label } from "./components/tokens";
          export const keys = { "hero.title": { type: "text", initial: "AI" } };
          export default function Home() { return <main>{label}</main>; }
        `,
      },
    ]);
    const template = await app.prisma.globalLayoutTemplate.findFirstOrThrow();

    const layout = await copyGlobalTemplateToSite(app, site.key, template.id, { destinationPath: "Home.tsx" });

    expect(layout.globalTemplateId).toBe(template.id);
    expect(layout.globalTemplateHash).toBe(template.sourceHash);
    expect(await readFile(join(config.LAYOUTS_DIR, site.key, "Home.tsx"), "utf-8")).toContain("./components/tokens");
    expect(await readFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "utf-8")).toContain("AI");
  });

  it("rejects initial copies when a helper target already exists", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/tokens.ts",
        content: "export const label = 'AI';",
      },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { label } from "./components/tokens";
          export const keys = { "hero.title": { type: "text", initial: "AI" } };
          export default function Home() { return <main>{label}</main>; }
        `,
      },
    ]);
    const template = await app.prisma.globalLayoutTemplate.findFirstOrThrow();
    await mkdir(join(config.LAYOUTS_DIR, site.key, "components"), { recursive: true });
    await writeFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "export const label = 'site-owned';");

    await expect(copyGlobalTemplateToSite(app, site.key, template.id, { destinationPath: "Home.tsx" })).rejects.toThrow(
      "Destination helper already exists"
    );

    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "utf-8")).resolves.toContain(
      "site-owned"
    );
    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "Home.tsx"), "utf-8")).rejects.toThrow();
  });

  it("refreshes helper files when copying from the linked global template", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/tokens.ts",
        content: "export const label = 'first';",
      },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { label } from "./components/tokens";
          export const keys = { "hero.title": { type: "text", initial: "AI" } };
          export default function Home() { return <main>{label}</main>; }
        `,
      },
    ]);
    const template = await app.prisma.globalLayoutTemplate.findFirstOrThrow();
    const layout = await copyGlobalTemplateToSite(app, site.key, template.id, { destinationPath: "Home.tsx" });
    await writeFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "export const label = 'site edit';");

    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/tokens.ts",
        content: "export const label = 'second';",
      },
    ]);

    const refreshed = await copyLinkedGlobalTemplateToLayout(app, site.key, layout.id);

    expect(refreshed.globalTemplateId).toBe(template.id);
    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "utf-8")).resolves.toContain(
      "second"
    );
  });

  it("does not copy sibling root templates as helpers on initial copy or refresh", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/tokens.ts",
        content: "export const label = 'first';",
      },
      {
        path: "sample-template/Home.tsx",
        content: `
          import { label } from "./components/tokens";
          export const keys = { "hero.title": { type: "text", initial: "AI" } };
          export default function Home() { return <main>{label}</main>; }
        `,
      },
      {
        path: "sample-template/About.tsx",
        content: `
          export const keys = { "about.title": { type: "text", initial: "About Global" } };
          export default function About() { return <main>About Global</main>; }
        `,
      },
    ]);
    const template = await app.prisma.globalLayoutTemplate.findUniqueOrThrow({
      where: { key: "sample-template/Home.tsx" },
    });
    await mkdir(join(config.LAYOUTS_DIR, site.key), { recursive: true });
    await writeFile(
      join(config.LAYOUTS_DIR, site.key, "About.tsx"),
      "export default function About() { return <main>Site-owned About</main>; }"
    );

    const layout = await copyGlobalTemplateToSite(app, site.key, template.id, { destinationPath: "Home.tsx" });

    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "About.tsx"), "utf-8")).resolves.toContain(
      "Site-owned About"
    );
    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "utf-8")).resolves.toContain(
      "first"
    );

    await syncGlobalLayoutBatch(app, [
      {
        path: "sample-template/components/tokens.ts",
        content: "export const label = 'second';",
      },
      {
        path: "sample-template/About.tsx",
        content: `
          export const keys = { "about.title": { type: "text", initial: "About Global v2" } };
          export default function About() { return <main>About Global v2</main>; }
        `,
      },
    ]);

    await copyLinkedGlobalTemplateToLayout(app, site.key, layout.id);

    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "About.tsx"), "utf-8")).resolves.toContain(
      "Site-owned About"
    );
    await expect(readFile(join(config.LAYOUTS_DIR, site.key, "components", "tokens.ts"), "utf-8")).resolves.toContain(
      "second"
    );
  });

  it("copies template assets and rewrites copyable global asset URLs in copied layout files", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "ai.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });

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
    const globalAsset = await app.prisma.globalAsset.findUniqueOrThrow({
      where: { key: "templates/sample-template/hero.webp" },
    });

    const layout = await copyGlobalTemplateToSite(app, site.key, template.id, { destinationPath: "Home.tsx" });

    const copiedHome = await readFile(join(config.LAYOUTS_DIR, site.key, "Home.tsx"), "utf-8");
    const copiedHero = await readFile(join(config.LAYOUTS_DIR, site.key, "components", "Hero.tsx"), "utf-8");
    expect(copiedHome).toContain("/assets/sample/hero.webp");
    expect(copiedHome).not.toContain("/assets/_global/templates/sample-template/hero.webp");
    expect(copiedHero).toContain("/assets/sample/hero.webp");
    expect(copiedHero).not.toContain("/assets/_global/templates/sample-template/hero.webp");
    expect(copiedHome).toContain("/assets/_global/shared/brands/demo-brand/logo.svg");
    await expect(readFile(join(config.ASSETS_DIR, "sample", "hero.webp"), "utf-8")).resolves.toBe("hero-webp");
    expect(layout.detectedKeys).toMatchObject({
      "hero.image": { type: "image", initial: "/assets/sample/hero.webp" },
      "brand.logo": { type: "image", initial: "/assets/_global/shared/brands/demo-brand/logo.svg" },
    });
    const siteAsset = await app.prisma.asset.findFirstOrThrow({
      where: { siteId: site.id, filePath: "/assets/sample/hero.webp" },
    });
    expect(siteAsset.globalAssetId).toBe(globalAsset.id);
    expect(siteAsset.globalAssetHash).toBe(globalAsset.sourceHash);
  });
});
