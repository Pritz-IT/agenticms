import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../src/app.js";
import { syncAssets, syncDefaultSiteAssets } from "../../src/services/asset-watcher.js";

let app: FastifyInstance;
let dir: string;
let demoSite: { id: string; key: string };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
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
  dir = await mkdtemp(join(tmpdir(), "sf-assets-"));
});

function demoOptions() {
  return { siteId: demoSite.id, urlPrefix: `/assets/${demoSite.key}` };
}

describe("syncAssets", () => {
  it("registers known files (with /assets/<rel> path), skips unknown ext, recurses", async () => {
    await writeFile(join(dir, "logo.png"), "x");
    await writeFile(join(dir, "notes.txt"), "x"); // unknown ext -> skipped
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(join(dir, "sub", "hero.webp"), "x");

    const r = await syncAssets(app.prisma, dir, demoOptions());

    expect(r.created).toBe(2);
    expect(r.skipped).toBe(1);
    const rows = await app.prisma.asset.findMany({ orderBy: { filePath: "asc" } });
    expect(rows.map((a) => a.filePath)).toEqual([
      "/assets/demo/logo.png",
      "/assets/demo/sub/hero.webp",
    ]);
    const png = rows.find((a) => a.filePath === "/assets/demo/logo.png")!;
    expect(png.mimeType).toBe("image/png");
    expect(png.filename).toBe("logo.png");
    expect(png.siteId).toBe(demoSite.id);

    await rm(dir, { recursive: true, force: true });
  });

  it("is idempotent — re-running creates no duplicates", async () => {
    await writeFile(join(dir, "a.png"), "x");
    await syncAssets(app.prisma, dir, demoOptions());
    const second = await syncAssets(app.prisma, dir, demoOptions());

    expect(second.created).toBe(0);
    expect(second.already).toBe(1);
    expect(await app.prisma.asset.count()).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });

  it("serializes concurrent syncs so duplicate watcher events do not create duplicate rows", async () => {
    await writeFile(join(dir, "race.png"), "x");

    const [first, second] = await Promise.all([
      syncAssets(app.prisma, dir, demoOptions()),
      syncAssets(app.prisma, dir, demoOptions()),
    ]);

    expect(first.created + second.created).toBe(1);
    expect(await app.prisma.asset.count({ where: { siteId: demoSite.id, filePath: "/assets/demo/race.png" } })).toBe(1);

    await rm(dir, { recursive: true, force: true });
  });

  it("syncs the default site root without duplicating the site key in URLs", async () => {
    await mkdir(join(dir, "demo"), { recursive: true });
    await writeFile(join(dir, "demo", "logo.png"), "x");

    const result = await syncDefaultSiteAssets(app.prisma, dir);

    expect(result.created).toBe(1);
    const rows = await app.prisma.asset.findMany({ where: { siteId: demoSite.id } });
    expect(rows.map((asset) => asset.filePath)).toEqual(["/assets/demo/logo.png"]);
    expect(rows.some((asset) => asset.filePath.includes("/assets/demo/demo/"))).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });

  it("treats a missing site asset directory as an empty sync", async () => {
    const missingDir = join(dir, "missing-site");

    const result = await syncAssets(app.prisma, missingDir, demoOptions());

    expect(result).toEqual({ scanned: 0, created: 0, already: 0, skipped: 0 });
    expect(await app.prisma.asset.count()).toBe(0);

    await rm(dir, { recursive: true, force: true });
  });
});
