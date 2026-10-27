import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { buildSiteConfig } from "../../src/services/website-build/site-config.js";
import { copyPostMedia, runBuild } from "../../src/services/website-build/build-runner.js";
import { createBlogFixture } from "../helpers/blog.js";

vi.mock("../../src/logging.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/logging.js")>(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
    child.kill = vi.fn();
    setImmediate(() => child.emit("exit", 0));
    return child;
  }),
}));

let app: FastifyInstance;
let tempDir: string;
let siteId: string;
let fixture: Awaited<ReturnType<typeof createBlogFixture>>;
const postKey = "school-bus-routing";
const mediaUrl = (file: string) => `/media/${postKey}/${file}`;
const originalConfig = { ...config };

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => { await app.close(); });
afterEach(async () => {
  vi.restoreAllMocks();
  Object.assign(config, originalConfig);
  await rm(tempDir, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await mkdtemp(join(tmpdir(), "blog-build-"));
  for (const [key, dir] of Object.entries({ LAYOUTS_DIR: "layouts", ASSETS_DIR: "assets", POST_MEDIA_DIR: "post-media", ASTRO_PROJECT_DIR: "astro", BUILDS_DIR: "builds" })) {
    Object.assign(config, { [key]: join(tempDir, dir) });
  }
  await app.prisma.site.deleteMany();
  const site = await app.prisma.site.create({ data: { key: "demo", name: "Demo", domain: "demo.local", stagingDomain: "staging.demo.local", defaultLocale: "de" } });
  siteId = site.id;
  await app.prisma.locale.createMany({ data: ["de", "en", "fr"].map((code) => ({ siteId, code, label: code, isDefault: code === "de" })) });
  fixture = await createBlogFixture(app, siteId);
  const pageLayout = await app.prisma.layout.create({ data: {
    siteId, name: "News", filePath: "News.tsx", detectedKeys: {
      articles: { type: "bloglist", initial: '{"categories":["other"]}' },
      defaults: { type: "bloglist", initial: '{"pageSize":null,"limit":1}' },
      title: { type: "text", initial: "News" },
    },
  } });
  await app.prisma.page.update({ where: { id: fixture.page.id }, data: { isPublished: true, layoutId: pageLayout.id } });
  await app.prisma.content.createMany({ data: [
    { pageId: fixture.page.id, key: "articles", locale: "de", type: "bloglist", value: '{"pageSize":2}' },
    { pageId: fixture.page.id, key: "articles", locale: "en", type: "bloglist", value: '{"categories":["other"]}' },
  ] });
  await mkdir(join(config.LAYOUTS_DIR, "demo"), { recursive: true });
  await writeFile(join(config.LAYOUTS_DIR, "demo", "Post.tsx"), "post layout");
  await writeFile(join(config.LAYOUTS_DIR, "demo", "News.tsx"), "page layout");
  await mkdir(join(config.ASTRO_PROJECT_DIR, "dist"), { recursive: true });
  await writeFile(join(config.ASTRO_PROJECT_DIR, "dist", "index.html"), "built page");
  await mkdir(join(config.ASSETS_DIR, "demo"), { recursive: true });
});

async function seedMedia() {
  const dir = join(config.POST_MEDIA_DIR, "demo", postKey);
  await mkdir(dir, { recursive: true });
  for (const file of ["cover.png", "body.png", "draft.png", "unused.png"]) await writeFile(join(dir, file), file);
  await mkdir(join(dir, "nested"));
  await writeFile(join(dir, "nested", "unused.png"), "nested");
  await mkdir(join(config.POST_MEDIA_DIR, "demo", "excluded"), { recursive: true });
  await writeFile(join(config.POST_MEDIA_DIR, "demo", "excluded", "private.png"), "private");
  await mkdir(join(config.ASTRO_PROJECT_DIR, "dist", "media", postKey), { recursive: true });
  await writeFile(join(config.ASTRO_PROJECT_DIR, "dist", "media", postKey, "body.png"), "stale");
  await writeFile(join(config.ASTRO_PROJECT_DIR, "dist", "media", "private.png"), "private");
  await app.prisma.blogPostTranslation.update({ where: { postId_locale: { postId: fixture.post.id, locale: "de" } }, data: {
    coverImage: mediaUrl("cover.png"), body: `<img src="${mediaUrl("body.png")}"><img src="${mediaUrl("cover.png")}">`,
  } });
  await app.prisma.blogPostTranslation.update({ where: { postId_locale: { postId: fixture.post.id, locale: "en" } }, data: { coverImage: mediaUrl("draft.png") } });
}

describe("blog build config", () => {
  it.each(["production", "staging"] as const)("selects %s translations and resolves lists per locale", async (target) => {
    const result = await buildSiteConfig(app.prisma, "demo", target);
    expect(result.buildTarget).toBe(target);
    expect(result.posts.map(({ key, locale, layoutFilePath }) => ({ key, locale, layoutFilePath }))).toEqual(
      (target === "production" ? ["de"] : ["de", "en"]).map((locale) => ({ key: postKey, locale, layoutFilePath: "Post.tsx" })),
    );
    expect(result.posts[0].translations.map(({ locale }) => locale)).toEqual(target === "production" ? ["de"] : ["de", "en"]);
    expect(result.blogLists).toEqual({ [fixture.page.id]: Object.fromEntries(["de", "en", "fr"].map((locale) => {
      const postKeys = locale === "de" || (locale === "en" && target === "staging") ? [postKey] : [];
      return [locale, { articles: { postKeys, pageSize: 2 }, defaults: { postKeys, pageSize: null } }];
    })) });
  });

  it.each(["production", "staging"] as const)("excludes unpublished category pages on %s", async (target) => {
    await app.prisma.page.update({ where: { id: fixture.page.id }, data: { isPublished: false } });
    const result = await buildSiteConfig(app.prisma, "demo", target);
    expect(result.posts).toEqual([]);
    expect(result.blogLists).toEqual({});
  });

  it("uses the post override before the category default", async () => {
    const override = await app.prisma.layout.create({ data: { siteId, name: "Override", filePath: "demo/Override.tsx", kind: "post" } });
    await writeFile(join(config.LAYOUTS_DIR, "demo", "Override.tsx"), "override");
    await app.prisma.blogPost.update({ where: { id: fixture.post.id }, data: { layoutId: override.id } });
    const result = await buildSiteConfig(app.prisma, "demo", "production");
    expect(result.posts[0].layoutFilePath).toBe("demo/Override.tsx");
  });

  it("fails with the post key when the layout file is missing", async () => {
    await rm(join(config.LAYOUTS_DIR, "demo", "Post.tsx"));
    const result = await runBuild(app.prisma, "build-id", "demo", "production");
    expect(result.success).toBe(false);
    expect(result.errorLog).toContain(postKey);
  });

  it.each([false, true])("fails with the post key for wrong-kind layouts (override: %s)", async (override) => {
    const layout = await app.prisma.layout.create({ data: { siteId, name: "Wrong", filePath: "Wrong.tsx", kind: "page" } });
    if (override) await app.prisma.blogPost.update({ where: { id: fixture.post.id }, data: { layoutId: layout.id } });
    else await app.prisma.blogCategory.update({ where: { id: fixture.category.id }, data: { defaultLayoutId: layout.id } });
    await expect(buildSiteConfig(app.prisma, "demo", "production")).rejects.toThrow(new RegExp(`${postKey}.*post`));
  });

  it("rejects layouts outside the selected site", async () => {
    const other = await app.prisma.site.create({ data: { key: "other", name: "Other", domain: "other.local", stagingDomain: "staging.other.local", defaultLocale: "de" } });
    const layout = await app.prisma.layout.create({ data: { siteId: other.id, name: "Other", filePath: "Post.tsx", kind: "post" } });
    await app.prisma.blogPost.update({ where: { id: fixture.post.id }, data: { layoutId: layout.id } });
    await expect(buildSiteConfig(app.prisma, "demo", "production")).rejects.toThrow(postKey);
  });

  it("fails a route collision naming both owners", async () => {
    await app.prisma.page.create({ data: { siteId, path: "/news/x", isPublished: true } });
    await expect(buildSiteConfig(app.prisma, "demo", "production")).rejects.toThrow(/page \/news\/x.*post school-bus-routing/);
  });
});

describe("post media build output", () => {
  it.each(["production", "staging"] as const)("copies only %s media for included posts", async (target) => {
    await seedMedia();
    const siteConfig = await buildSiteConfig(app.prisma, "demo", target);
    const output = join(tempDir, "output");
    const count = await copyPostMedia("demo", siteConfig.posts, output, target);
    const files = target === "production" ? ["body.png", "cover.png"] : ["body.png", "cover.png", "draft.png", "nested", "unused.png"];
    expect(await readdir(join(output, "media", postKey))).toEqual(files);
    expect(count).toBe(files.length);
    if (target === "staging") await expect(readFile(join(output, "media", postKey, "nested", "unused.png"), "utf-8")).resolves.toBe("nested");
    expect(existsSync(join(output, "media", "excluded"))).toBe(false);
    await expect(readFile(join(output, "media", postKey, "body.png"), "utf-8")).resolves.toBe("body.png");
  });

  it("defaults the three-argument media helper to production", async () => {
    await seedMedia();
    const { posts } = await buildSiteConfig(app.prisma, "demo", "production");
    const output = join(tempDir, "output");
    expect(await copyPostMedia("demo", posts, output)).toBe(2);
    expect(await readdir(join(output, "media", postKey))).toEqual(["body.png", "cover.png"]);
  });

  it.each(["production", "staging"] as const)("allows posts without a media directory on %s and logs NO-OP", async (target) => {
    const { posts } = await buildSiteConfig(app.prisma, "demo", target);
    expect(await copyPostMedia("demo", posts, join(tempDir, "output"), target)).toBe(0);
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ op: "blog.build.media", mediaFiles: 0 }), expect.stringContaining("NO-OP"));
  });

  it.each(["production", "staging"] as const)("rejects invalid media paths on %s", async (target) => {
    await app.prisma.blogPostTranslation.update({ where: { postId_locale: { postId: fixture.post.id, locale: "de" } }, data: { coverImage: "/media/../private.png" } });
    const { posts } = await buildSiteConfig(app.prisma, "demo", target);
    await expect(copyPostMedia("demo", posts, join(tempDir, "output"), target)).rejects.toThrow(/school-bus-routing.*\/media\/\.\.\/private.png/);
  });

  it.each(["production", "staging"] as const)("fails %s for missing references before activating the build", async (target) => {
    await seedMedia();
    await rm(join(config.POST_MEDIA_DIR, "demo", postKey, "body.png"));
    const result = await runBuild(app.prisma, "build-id", "demo", target);
    expect(result.success).toBe(false);
    expect(result.errorLog).toContain(postKey);
    expect(result.errorLog).toContain(mediaUrl("body.png"));
    expect(existsSync(join(config.BUILDS_DIR, "demo", `current-${target}`))).toBe(false);
  });

  it.each(["production", "staging"] as const)("writes %s config, copies media after dist, and logs counts", async (target) => {
    await seedMedia();
    const info = vi.spyOn(log, "info");
    const result = await runBuild(app.prisma, "build-id", "demo", target);
    expect(result.success).toBe(true);
    const serialized = JSON.parse(await readFile(join(config.ASTRO_PROJECT_DIR, "src", "data", "config.json"), "utf-8"));
    expect(serialized.buildTarget).toBe(target);
    expect(serialized.posts).toHaveLength(target === "production" ? 1 : 2);
    expect(serialized.blogLists[fixture.page.id].fr.articles.postKeys).toEqual([]);
    await expect(readFile(join(result.outputPath!, "index.html"), "utf-8")).resolves.toBe("built page");
    await expect(readFile(join(result.outputPath!, "media", postKey, "body.png"), "utf-8")).resolves.toBe("body.png");
    expect(existsSync(join(result.outputPath!, "media", "private.png"))).toBe(false);
    expect(info).toHaveBeenCalledWith({ op: "blog.build", target, posts: 1, translations: target === "production" ? 1 : 2, mediaFiles: target === "production" ? 2 : 5 }, expect.any(String));
  });
});
