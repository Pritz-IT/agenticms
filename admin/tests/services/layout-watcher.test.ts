import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdir, mkdtemp, unlink, writeFile } from "fs/promises";
import type { FastifyInstance } from "fastify";
import { join } from "path";
import { tmpdir } from "os";
import { buildApp } from "../../src/app.js";
import { LayoutModuleCache } from "../../src/services/layout-module-cache.js";
import { handleFile, prefillContent, startLayoutWatcher } from "../../src/services/layout-watcher.js";
import type { LayoutModuleCacheEntry } from "../../src/services/layout-module-cache.js";

let app: FastifyInstance;
let defaultSiteId: string;
let sampleSiteId: string;

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for assertion");
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();

  const site = await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Demo Site",
      domain: "example.com",
      stagingDomain: "staging.example.com",
      defaultLocale: "en",
    },
  });
  defaultSiteId = site.id;
  const sampleSite = await app.prisma.site.create({
    data: {
      key: "sample-site",
      name: "Sample Site",
      domain: "sample-site.localhost",
      stagingDomain: "staging-sample-site.localhost",
      defaultLocale: "en",
    },
  });
  sampleSiteId = sampleSite.id;
});

describe("prefillContent", () => {
  it("does not create page content rows for navigation editor keys", async () => {
    const layout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "DemoHome",
        filePath: "/layouts/DemoHome.tsx",
        detectedKeys: {
          "header.navigation": { type: "navigation", initial: "" },
          "hero.title": { type: "text", initial: "Hello" },
        },
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/demo", layoutId: layout.id },
    });
    await app.prisma.locale.create({
      data: { siteId: defaultSiteId, code: "en", label: "English", isDefault: true },
    });

    await prefillContent(app.prisma, layout.filePath, {
      "header.navigation": { type: "navigation", initial: "" },
      "hero.title": { type: "text", initial: "Hello" },
    }, { siteId: defaultSiteId });

    const rows = await app.prisma.content.findMany({
      where: { pageId: page.id },
      orderBy: { key: "asc" },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "hero.title", type: "text", value: "Hello" });
  });
});

describe("handleFile layout module cache integration", () => {
  it("does not fall back to the default site when a nested watched directory is not a site", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-unknown-site-"));
    const file = join(dir, "Home.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Wrong site" } };
      export default function Home() { return <main>Wrong site</main>; }
    `);

    await handleFile(app.prisma, file, undefined, {
      siteKey: "agenticms",
      storedFilePath: "Home.tsx",
    });

    await expect(app.prisma.layout.count()).resolves.toBe(0);
  });

  it("does not register global template files as default-site layouts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-global-site-"));
    const file = join(dir, "Home.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Global" } };
      export default function Home() { return <main>Global</main>; }
    `);

    await handleFile(app.prisma, file, undefined, {
      siteKey: "_global",
      storedFilePath: "sample-template/Home.tsx",
    });

    await expect(app.prisma.layout.count()).resolves.toBe(0);
  });

  it("migrates a legacy /layouts row to the canonical root-relative path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-legacy-"));
    const file = join(dir, "Legacy.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Fresh" } };
      export default function Legacy() { return <main>Fresh</main>; }
    `);

    const legacyLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "Legacy",
        filePath: "/layouts/Legacy.tsx",
        detectedKeys: { "hero.title": { type: "text", initial: "Stale" } },
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/legacy", layoutId: legacyLayout.id },
    });

    await handleFile(app.prisma, file, undefined, { storedFilePath: "Legacy.tsx" });

    const canonicalLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "Legacy.tsx" } } });
    const staleLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "/layouts/Legacy.tsx" } } });
    const updatedPage = await app.prisma.page.findUnique({ where: { id: page.id } });

    expect(canonicalLayout?.id).toBe(legacyLayout.id);
    expect(canonicalLayout?.detectedKeys).toMatchObject({
      "hero.title": { type: "text", initial: "Fresh" },
    });
    expect(staleLayout).toBeNull();
    expect(updatedPage?.layoutId).toBe(legacyLayout.id);
  });

  it("merges duplicate legacy rows into the canonical layout and keeps pages attached", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-duplicate-"));
    const file = join(dir, "Duplicate.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Canonical" } };
      export default function Duplicate() { return <main>Canonical</main>; }
    `);

    const canonicalLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "Duplicate",
        filePath: "Duplicate.tsx",
        detectedKeys: { "hero.title": { type: "text", initial: "Old canonical" } },
      },
    });
    const legacyLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "Duplicate",
        filePath: "/layouts/Duplicate.tsx",
        detectedKeys: { "hero.title": { type: "text", initial: "Stale legacy" } },
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/duplicate", layoutId: legacyLayout.id },
    });

    await handleFile(app.prisma, file, undefined, { storedFilePath: "Duplicate.tsx" });

    const updatedCanonical = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "Duplicate.tsx" } } });
    const staleLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "/layouts/Duplicate.tsx" } } });
    const updatedPage = await app.prisma.page.findUnique({ where: { id: page.id } });

    expect(updatedCanonical?.id).toBe(canonicalLayout.id);
    expect(updatedCanonical?.detectedKeys).toMatchObject({
      "hero.title": { type: "text", initial: "Canonical" },
    });
    expect(staleLayout).toBeNull();
    expect(updatedPage?.layoutId).toBe(canonicalLayout.id);
  });

  it("migrates root layout rows into a nested canonical layout path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-nested-"));
    const file = join(dir, "DemoHome.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Nested" } };
      export default function DemoHome() { return <main>Nested</main>; }
    `);

    const rootLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "DemoHome",
        filePath: "DemoHome.tsx",
        detectedKeys: { "hero.title": { type: "text", initial: "Root" } },
      },
    });
    const legacyLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "DemoHome",
        filePath: "/layouts/DemoHome.tsx",
        detectedKeys: { "hero.title": { type: "text", initial: "Legacy" } },
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/home", layoutId: legacyLayout.id },
    });

    await handleFile(app.prisma, file, undefined, { storedFilePath: "demo/DemoHome.tsx" });

    const nestedLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "demo/DemoHome.tsx" } } });
    const rootStaleLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "DemoHome.tsx" } } });
    const legacyStaleLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "/layouts/DemoHome.tsx" } } });
    const updatedPage = await app.prisma.page.findUnique({ where: { id: page.id } });

    expect(nestedLayout?.id).toBe(rootLayout.id);
    expect(rootStaleLayout).toBeNull();
    expect(legacyStaleLayout).toBeNull();
    expect(updatedPage?.layoutId).toBe(rootLayout.id);
    expect(nestedLayout?.detectedKeys).toMatchObject({
      "hero.title": { type: "text", initial: "Nested" },
    });
  });

  it("merges stale absolute layout rows into a nested canonical layout path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-absolute-"));
    const legacyDir = await mkdtemp(join(tmpdir(), "sf-watcher-legacy-absolute-"));
    const file = join(dir, "DemoHome.tsx");
    const legacyFile = join(legacyDir, "DemoHome.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Nested" } };
      export default function DemoHome() { return <main>Nested</main>; }
    `);

    const canonicalLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "DemoHome",
        filePath: "demo/DemoHome.tsx",
        detectedKeys: { "hero.title": { type: "text", initial: "Canonical" } },
      },
    });
    const absoluteLayout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "DemoHome",
        filePath: legacyFile,
        detectedKeys: { "hero.title": { type: "text", initial: "Absolute" } },
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/home", layoutId: absoluteLayout.id },
    });

    await handleFile(app.prisma, file, undefined, { storedFilePath: "demo/DemoHome.tsx" });

    const nestedLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "demo/DemoHome.tsx" } } });
    const staleAbsoluteLayout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: legacyFile } } });
    const updatedPage = await app.prisma.page.findUnique({ where: { id: page.id } });

    expect(nestedLayout?.id).toBe(canonicalLayout.id);
    expect(staleAbsoluteLayout).toBeNull();
    expect(updatedPage?.layoutId).toBe(canonicalLayout.id);
    expect(nestedLayout?.detectedKeys).toMatchObject({
      "hero.title": { type: "text", initial: "Nested" },
    });
  });

  it("populates the compiled module cache for valid layouts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-cache-"));
    const file = join(dir, "Cached.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Cached() { return <main>Hello</main>; }
    `);
    const cache = new LayoutModuleCache(join(dir, ".cache"));

    await handleFile(app.prisma, file, cache);

    const layout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: file } } });
    expect(layout).toBeTruthy();
    const entry = await cache.get(layout!.id);
    expect(entry?.code).toContain("Cached");
  });

  it("can store a root-relative file path while compiling from an absolute path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-cache-"));
    const file = join(dir, "RelativeStored.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function RelativeStored() { return <main>Hello</main>; }
    `);
    const cache = new LayoutModuleCache(join(dir, ".cache"));

    await handleFile(app.prisma, file, cache, { storedFilePath: "RelativeStored.tsx" });

    const layout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "RelativeStored.tsx" } } });
    expect(layout).toBeTruthy();
    const entry = await cache.get(layout!.id);
    expect(entry?.code).toContain("RelativeStored");
  });


  it("keeps last-good when a later save fails compilation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-cache-"));
    const file = join(dir, "Stale.tsx");
    const cache = new LayoutModuleCache(join(dir, ".cache"));
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Stale() { return <main>Good</main>; }
    `);
    await handleFile(app.prisma, file, cache);
    const layout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: file } } });
    expect(await cache.getLastGood(layout!.id)).toContain("Good");

    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Stale() { return <main>; }
    `);
    await handleFile(app.prisma, file, cache);

    expect(await cache.getLastGood(layout!.id)).toContain("Good");
  });

  it("evicts the compiled module cache when the watched layout is removed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-cache-"));
    const file = join(dir, "Removed.tsx");
    const cache = new LayoutModuleCache(join(dir, ".cache"));
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Removed() { return <main>Removed</main>; }
    `);

    const watcher = startLayoutWatcher(app.prisma, dir, cache);
    try {
      await waitFor(async () => {
        const layout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "Removed.tsx" } } });
        return Boolean(layout && await cache.get(layout.id));
      });

      const layout = await app.prisma.layout.findUnique({ where: { siteId_filePath: { siteId: defaultSiteId, filePath: "Removed.tsx" } } });
      expect(layout).toBeTruthy();
      await unlink(file);

      await waitFor(async () => (await cache.getLastGood(layout!.id)) === null);
    } finally {
      await watcher.close();
    }
  });

  it("serializes watcher events for the same file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-cache-"));
    const file = join(dir, "Serial.tsx");
    const events: string[] = [];
    let releaseSet!: () => void;
    let releaseFinish!: () => void;
    const setStarted = new Promise<void>((resolve) => {
      releaseSet = resolve;
    });
    const setCanFinish = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    const cache = {
      computeInputHash: vi.fn(async () => "hash"),
      set: vi.fn(async () => {
        events.push("set:start");
        releaseSet();
        await setCanFinish;
        events.push("set:end");
      }),
      evict: vi.fn(async () => {
        events.push("evict");
      }),
      get: vi.fn(async (): Promise<LayoutModuleCacheEntry | null> => null),
      getLastGood: vi.fn(async (): Promise<string | null> => null),
    } as unknown as LayoutModuleCache;

    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Serial() { return <main>Serial</main>; }
    `);
    await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Serial", filePath: "Serial.tsx", detectedKeys: {} },
    });

    const watcher = startLayoutWatcher(app.prisma, dir, cache);
    try {
      await setStarted;
      watcher.emit("unlink", file);
      expect(events).toEqual(["set:start"]);
      releaseFinish();
      await waitFor(async () => events.includes("evict"));
      expect(events).toEqual(["set:start", "set:end", "evict"]);
    } finally {
      await watcher.close();
    }
  });

  it("stores paths relative to a detected site directory and merges stale site-prefixed rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sf-watcher-sites-"));
    await mkdir(join(dir, "sample-site", "agenticms"), { recursive: true });
    const file = join(dir, "sample-site", "agenticms", "AgentiCmsLiveDemo.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "CMS" } };
      export default function AgentiCmsLiveDemo() { return <main>CMS</main>; }
    `);
    const staleLayout = await app.prisma.layout.create({
      data: {
        siteId: sampleSiteId,
        name: "AgentiCmsLiveDemo",
        filePath: "sample-site/agenticms/AgentiCmsLiveDemo.tsx",
        detectedKeys: {},
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: sampleSiteId, path: "/cms", layoutId: staleLayout.id },
    });

    const watcher = startLayoutWatcher(app.prisma, dir);
    try {
      await waitFor(async () => {
        const canonical = await app.prisma.layout.findUnique({
          where: { siteId_filePath: { siteId: sampleSiteId, filePath: "agenticms/AgentiCmsLiveDemo.tsx" } },
        });
        const stale = await app.prisma.layout.findUnique({
          where: { siteId_filePath: { siteId: sampleSiteId, filePath: "sample-site/agenticms/AgentiCmsLiveDemo.tsx" } },
        });
        const updatedPage = await app.prisma.page.findUnique({ where: { id: page.id } });
        return Boolean(canonical && !stale && updatedPage?.layoutId === canonical.id);
      });
    } finally {
      await watcher.close();
    }
  });
});
