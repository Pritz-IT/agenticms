import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
    child.kill = vi.fn();
    setImmediate(() => child.emit("exit", 0));
    return child;
  }),
}));

let prisma: PrismaClient;
let tempDir: string;

async function loadRunner() {
  vi.resetModules();
  vi.stubEnv("LAYOUTS_DIR", join(tempDir, "layouts"));
  vi.stubEnv("ASSETS_DIR", join(tempDir, "assets"));
  vi.stubEnv("ASTRO_PROJECT_DIR", join(tempDir, "astro"));
  vi.stubEnv("BUILDS_DIR", join(tempDir, "builds"));
  vi.stubEnv("MAX_BUILDS", "5");
  return import("../../src/services/website-build/build-runner.js");
}

beforeAll(() => {
  prisma = new PrismaClient();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-site-build-"));
  await prisma.build.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.page.deleteMany();
  await prisma.layout.deleteMany();
  await prisma.locale.deleteMany();
  await prisma.site.deleteMany();
});

describe("site-scoped website builds", () => {
  it("stages only the selected site and publishes under its build directory", async () => {
    const demo = await prisma.site.create({
      data: { key: "demo", name: "Demo Site", domain: "demo.local", stagingDomain: "staging.demo.local", defaultLocale: "de" },
    });
    const agenticms = await prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await prisma.layout.createMany({
      data: [
        { siteId: demo.id, name: "Home", filePath: "Home.astro" },
        { siteId: agenticms.id, name: "Home", filePath: "agenticms/Home.astro" },
      ],
    });
    await prisma.locale.createMany({
      data: [
        { siteId: demo.id, code: "de", label: "Deutsch", isDefault: true },
        { siteId: agenticms.id, code: "en", label: "English", isDefault: true },
      ],
    });
    await prisma.asset.createMany({
      data: [
        { siteId: demo.id, filename: "logo.png", mimeType: "image/png", filePath: "/assets/demo/logo.png", uploadedBy: "test" },
        { siteId: agenticms.id, filename: "logo.png", mimeType: "image/png", filePath: "/assets/agenticms/logo.png", uploadedBy: "test" },
      ],
    });

    await mkdir(join(tempDir, "layouts", "demo"), { recursive: true });
    await mkdir(join(tempDir, "layouts", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "demo", "Home.astro"), "demo layout");
    await writeFile(join(tempDir, "layouts", "agenticms", "Home.astro"), "agenticms layout");
    await mkdir(join(tempDir, "assets", "demo"), { recursive: true });
    await mkdir(join(tempDir, "assets", "agenticms"), { recursive: true });
    await mkdir(join(tempDir, "assets", "_global", "shared", "brand"), { recursive: true });
    await mkdir(join(tempDir, "assets", "_global", "templates", "starter"), { recursive: true });
    await writeFile(join(tempDir, "assets", "demo", "logo.png"), "demo asset");
    await writeFile(join(tempDir, "assets", "agenticms", "logo.png"), "agenticms asset");
    await writeFile(join(tempDir, "assets", "_global", "shared", "brand", "logo.svg"), "global logo");
    await writeFile(join(tempDir, "assets", "_global", "templates", "starter", "hero.png"), "template hero");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>built</h1>");

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "agenticms", "staging");

    expect(result.success).toBe(true);
    expect(result.outputPath).toMatch(new RegExp(`/builds/agenticms/staging-\\d+$`));
    await expect(readFile(join(tempDir, "astro", "src", "layouts", "Home.astro"), "utf-8")).resolves.toBe("agenticms layout");
    await expect(readFile(join(tempDir, "astro", "public", "assets", "agenticms", "logo.png"), "utf-8")).resolves.toBe("agenticms asset");
    await expect(readFile(join(tempDir, "astro", "public", "assets", "_global", "shared", "brand", "logo.svg"), "utf-8")).resolves.toBe(
      "global logo"
    );
    expect(existsSync(join(tempDir, "astro", "public", "assets", "demo"))).toBe(false);
    expect(existsSync(join(tempDir, "astro", "public", "assets", "_global", "templates"))).toBe(false);
    expect(existsSync(join(tempDir, "builds", "agenticms", "current-staging"))).toBe(true);
    expect(existsSync(join(tempDir, "builds", "current-staging"))).toBe(false);
  });

  it("does not rewrite another site's current build links", async () => {
    const demo = await prisma.site.create({
      data: { key: "demo", name: "Demo Site", domain: "demo.local", stagingDomain: "staging.demo.local", defaultLocale: "de" },
    });
    const sample = await prisma.site.create({
      data: {
        key: "sample",
        name: "Sample Template",
        domain: "sample.local",
        stagingDomain: "staging-ai.local",
        defaultLocale: "de",
      },
    });
    await prisma.layout.create({ data: { siteId: demo.id, name: "Home", filePath: "Home.astro" } });
    await prisma.locale.createMany({
      data: [
        { siteId: demo.id, code: "de", label: "Deutsch", isDefault: true },
        { siteId: sample.id, code: "de", label: "Deutsch", isDefault: true },
      ],
    });

    await mkdir(join(tempDir, "layouts", "demo"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "demo", "Home.astro"), "demo layout");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>demo staging</h1>");

    const existingAiProduction = join(tempDir, "builds", "sample", "production-existing");
    await mkdir(existingAiProduction, { recursive: true });
    await writeFile(join(existingAiProduction, "index.html"), "<h1>live ai readiness</h1>");
    await symlink(existingAiProduction, join(tempDir, "builds", "sample", "current-production"));

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "demo", "staging");

    expect(result.success).toBe(true);
    await expect(readlink(join(tempDir, "builds", "sample", "current-production"))).resolves.toBe(existingAiProduction);
    await expect(readFile(join(tempDir, "builds", "sample", "current-production", "index.html"), "utf-8")).resolves.toBe(
      "<h1>live ai readiness</h1>"
    );
    expect(existsSync(join(tempDir, "builds", "demo", "current-staging"))).toBe(true);
    expect(existsSync(join(tempDir, "builds", "sample", "current-staging"))).toBe(false);
  });

  it("stages shared global assets when the selected site has no asset directory", async () => {
    const site = await prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await prisma.layout.create({
      data: { siteId: site.id, name: "Home", filePath: "Home.astro" },
    });
    await prisma.locale.create({
      data: { siteId: site.id, code: "en", label: "English", isDefault: true },
    });

    await mkdir(join(tempDir, "layouts", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "agenticms", "Home.astro"), "agenticms layout");
    await mkdir(join(tempDir, "assets", "_global", "shared"), { recursive: true });
    await mkdir(join(tempDir, "assets", "_global", "templates"), { recursive: true });
    await writeFile(join(tempDir, "assets", "_global", "shared", "logo.svg"), "global logo");
    await writeFile(join(tempDir, "assets", "_global", "templates", "layout-preview.png"), "template preview");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>built</h1>");

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "agenticms", "staging");

    expect(result.success).toBe(true);
    await expect(readFile(join(tempDir, "astro", "public", "assets", "_global", "shared", "logo.svg"), "utf-8")).resolves.toBe(
      "global logo"
    );
    expect(existsSync(join(tempDir, "astro", "public", "assets", "_global", "templates"))).toBe(false);
  });

  it("rejects rollback output paths outside the selected site and target", async () => {
    await mkdir(join(tempDir, "builds", "demo", "staging-1"), { recursive: true });
    await mkdir(join(tempDir, "builds", "agenticms", "staging-1"), { recursive: true });

    const { rollback } = await loadRunner();

    const wrongSite = await rollback(prisma, "build-id", join(tempDir, "builds", "agenticms", "staging-1"), "demo", "staging");
    expect(wrongSite).toMatchObject({ success: false });

    const wrongTarget = await rollback(prisma, "build-id", join(tempDir, "builds", "demo", "production-1"), "demo", "staging");
    expect(wrongTarget).toMatchObject({ success: false });
  });

  it("rewrites an empty site staging htpasswd when staging access is revoked", async () => {
    const site = await prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await prisma.layout.create({
      data: { siteId: site.id, name: "Home", filePath: "Home.astro" },
    });
    await prisma.locale.create({
      data: { siteId: site.id, code: "en", label: "English", isDefault: true },
    });
    await mkdir(join(tempDir, "layouts", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "agenticms", "Home.astro"), "agenticms layout");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>built</h1>");
    await mkdir(join(tempDir, "builds", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "builds", "agenticms", ".htpasswd-staging"), "old:hash\n");

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "agenticms", "staging");

    expect(result.success).toBe(true);
    const htpasswdPath = join(tempDir, "builds", "agenticms", ".htpasswd-staging");
    await expect(readFile(htpasswdPath, "utf-8")).resolves.toBe("");
    await expect(stat(join(tempDir, "builds", "agenticms", ".htpasswd-production"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsafe staging access usernames before writing staging htpasswd", async () => {
    const site = await prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await prisma.layout.create({
      data: { siteId: site.id, name: "Home", filePath: "Home.astro" },
    });
    await prisma.locale.create({
      data: { siteId: site.id, code: "en", label: "English", isDefault: true },
    });
    await prisma.stagingAccess.create({
      data: { siteId: site.id, username: "preview:user", passwordHash: "hash" },
    });
    await mkdir(join(tempDir, "layouts", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "agenticms", "Home.astro"), "agenticms layout");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>built</h1>");

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "agenticms", "staging");

    expect(result).toMatchObject({
      success: false,
      errorLog: "Invalid staging access username: preview:user",
    });
    await expect(stat(join(tempDir, "builds", "agenticms", ".htpasswd-staging"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(join(tempDir, "builds", "agenticms", "current-staging"))).toBe(false);
  });

  it("rejects unsafe staging access password hashes before publishing staging builds", async () => {
    const site = await prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await prisma.layout.create({
      data: { siteId: site.id, name: "Home", filePath: "Home.astro" },
    });
    await prisma.locale.create({
      data: { siteId: site.id, code: "en", label: "English", isDefault: true },
    });
    await prisma.stagingAccess.create({
      data: { siteId: site.id, username: "preview", passwordHash: "hash\ninjected:hash" },
    });
    await mkdir(join(tempDir, "layouts", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "agenticms", "Home.astro"), "agenticms layout");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>built</h1>");

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "agenticms", "staging");

    expect(result).toMatchObject({
      success: false,
      errorLog: "Invalid staging access password hash for preview",
    });
    await expect(stat(join(tempDir, "builds", "agenticms", ".htpasswd-staging"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(join(tempDir, "builds", "agenticms", "current-staging"))).toBe(false);
  });

  it("omits expired staging access entries during staging builds", async () => {
    const site = await prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await prisma.layout.create({
      data: { siteId: site.id, name: "Home", filePath: "Home.astro" },
    });
    await prisma.locale.create({
      data: { siteId: site.id, code: "en", label: "English", isDefault: true },
    });
    await prisma.stagingAccess.createMany({
      data: [
        { siteId: site.id, username: "active", passwordHash: "active-hash", expiresAt: new Date(Date.now() + 60000) },
        { siteId: site.id, username: "expired", passwordHash: "expired-hash", expiresAt: new Date(Date.now() - 60000) },
      ],
    });
    await mkdir(join(tempDir, "layouts", "agenticms"), { recursive: true });
    await writeFile(join(tempDir, "layouts", "agenticms", "Home.astro"), "agenticms layout");
    await mkdir(join(tempDir, "astro", "dist"), { recursive: true });
    await writeFile(join(tempDir, "astro", "dist", "index.html"), "<h1>built</h1>");

    const { runBuild } = await loadRunner();
    const result = await runBuild(prisma, "build-id", "agenticms", "staging");

    expect(result.success).toBe(true);
    await expect(readFile(join(tempDir, "builds", "agenticms", ".htpasswd-staging"), "utf-8")).resolves.toBe("active:active-hash");
  });
});
