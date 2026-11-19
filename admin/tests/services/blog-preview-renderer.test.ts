import { execFile } from "node:child_process";
import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import type { Site } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { log } from "../../src/logging.js";
import { PreviewRenderError, renderPostPreview } from "../../src/services/blog/preview-renderer.js";
import { PostError, savePost } from "../../src/services/blog/posts.js";
import { cleanupPreviewFixture, createPreviewFixture, previewInput, website } from "../helpers/blog-preview.js";
import { buildSiteConfig } from "../../src/services/website-build/site-config.js";

const run = promisify(execFile);
const mediaPrefix = "/preview/TOKEN/media";
const input = previewInput;

let app: FastifyInstance;
let tempDir: string;
let site: Site;

beforeAll(async () => { app = await buildApp({ logger: false }); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { ({ site, tempDir } = await createPreviewFixture(app)); });
afterEach(async () => { await cleanupPreviewFixture(tempDir); });

describe("renderPostPreview", () => {
  it("renders the unsaved post with the real layout, head and sanitised body", async () => {
    const html = await renderPostPreview(app.prisma, site, input({ body: `<p>Typed</p><script>alert(1)</script><img src="/media/hello/a.webp" alt="A">`, coverImage: "/media/hello/cover.webp" }), "en", mediaPrefix, log);

    expect(html).toMatch(/^<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">/);
    expect(html).toContain("<title>Hello preview</title>");
    expect(html).toContain(`<meta name="robots" content="noindex">`);
    expect(html).toContain(`<link rel="canonical" href="https://preview.test/news/hello/">`);
    expect(html).toContain("<h1>Hello preview</h1>");
    expect(html).toContain("News");
    expect(html).toContain("Operations");
    expect(html).toContain(`href="/de/news/hallo/"`);
    expect(html).toContain("<p>Typed</p>");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain(`src="${mediaPrefix}/hello/a.webp"`);
    expect(html).toContain(`class="example-post-cover" src="${mediaPrefix}/hello/cover.webp"`);
    expect(html).toContain(`content="https://preview.test/media/hello/cover.webp"`);
    expect(html).toContain(`<script src="/preview/live.js" defer></script>`);
    expect(await app.prisma.blogPost.count()).toBe(0);
  });

  it("rejects what a save would reject, and a locale the input does not carry", async () => {
    await expect(renderPostPreview(app.prisma, site, input({ body: `<img src="/media/hello/a.webp">` }), "en", mediaPrefix, log))
      .rejects.toThrow(/alt text/);
    await expect(renderPostPreview(app.prisma, site, input(), "fr", mediaPrefix, log)).rejects.toBeInstanceOf(PostError);
  });

  it("reports a layout that throws while rendering", async () => {
    await writeFile(join(config.LAYOUTS_DIR, site.key, "ExamplePost.tsx"), `export const layoutKind = "post";\nexport default function Broken() { throw new Error("kaputt"); }\n`);
    const error = await renderPostPreview(app.prisma, site, input(), "en", mediaPrefix, log).catch((caught) => caught);
    expect(error).toBeInstanceOf(PreviewRenderError);
    expect(error.message).toContain("kaputt");
  });

  it("matches the static staging build of the same saved post", async () => {
    await savePost(app.prisma, site, input(), log);
    const preview = await renderPostPreview(app.prisma, site, input(), "en", mediaPrefix, log);

    const astro = join(tempDir, "astro");
    await mkdir(astro);
    for (const entry of ["src", "astro.config.mjs", "package.json", "tsconfig.json"]) await cp(join(website, entry), join(astro, entry), { recursive: true });
    await symlink(join(website, "node_modules"), join(astro, "node_modules"));
    await cp(join(config.LAYOUTS_DIR, site.key), join(astro, "src", "layouts"), { recursive: true });
    await writeFile(join(astro, "src", "data", "config.json"), JSON.stringify(await buildSiteConfig(app.prisma, site.key, "staging")));
    await run(join(astro, "node_modules", ".bin", "astro"), ["build"], { cwd: astro });
    const built = await readFile(join(astro, "dist", "news", "hello", "index.html"), "utf-8");

    const normalise = (html: string) => html.replace(`<script src="/preview/live.js" defer></script>`, "").replace(/>\s+</g, "><").trim();
    expect(normalise(preview)).toBe(normalise(built));
  }, 120_000);
});
