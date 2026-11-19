import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Site } from "@prisma/client";
import { config } from "../../src/config.js";
import { parseLayoutKeys, parseLayoutKind } from "../../src/services/layout-parser.js";
import type { PostInput } from "../../src/services/blog/posts.js";

export const website = resolve("../website");
const examples = resolve("../examples/layouts");
const originalConfig = { ...config };

export function previewInput(overrides: Partial<PostInput["translations"][string]> = {}): PostInput {
  return {
    key: "hello", category: "news", tags: ["ops"], layout: null, publishedAt: "2026-11-12",
    translations: {
      en: { slug: "hello", title: "Hello preview", excerpt: "Short.", body: "<p>Ready to share.</p>", coverImage: "", metaTitle: "", metaDescription: "", ...overrides },
      de: { slug: "hallo", title: "Hallo", excerpt: "Kurz.", body: "<p>Bereit.</p>", coverImage: "", metaTitle: "", metaDescription: "" },
    },
  };
}

/** A site with the example post layout on disk, a news category and one tag, in a temp dir. */
export async function createPreviewFixture(app: FastifyInstance): Promise<{ site: Site; tempDir: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "blog-preview-"));
  Object.assign(config, {
    LAYOUTS_DIR: join(tempDir, "layouts"), COMPILED_LAYOUTS_DIR: join(tempDir, "compiled"),
    POST_MEDIA_DIR: join(tempDir, "post-media"), ASTRO_PROJECT_DIR: website,
  });
  await app.prisma.site.deleteMany();
  const site = await app.prisma.site.create({ data: {
    key: "preview", name: "Preview Site", domain: "preview.test", stagingDomain: "staging.preview.test", defaultLocale: "en", siteUrl: "https://preview.test",
    locales: { create: [{ code: "en", label: "English", isDefault: true, sortOrder: 0 }, { code: "de", label: "Deutsch", sortOrder: 1 }] },
  } });
  await cp(examples, join(config.LAYOUTS_DIR, site.key), { recursive: true });
  const source = await readFile(join(examples, "ExamplePost.tsx"), "utf-8");
  const layout = await app.prisma.layout.create({ data: {
    siteId: site.id, name: "ExamplePost", filePath: "ExamplePost.tsx", kind: parseLayoutKind(source), detectedKeys: parseLayoutKeys(source),
  } });
  const page = await app.prisma.page.create({ data: { siteId: site.id, path: "/news", isPublished: true } });
  await app.prisma.blogCategory.create({ data: {
    siteId: site.id, key: "news", pageId: page.id, defaultLayoutId: layout.id,
    names: { create: [{ locale: "en", name: "News" }, { locale: "de", name: "Neuigkeiten" }] },
  } });
  await app.prisma.blogTag.create({ data: { siteId: site.id, key: "ops", names: { create: [{ locale: "en", name: "Operations" }] } } });
  return { site, tempDir };
}

export async function cleanupPreviewFixture(tempDir: string) {
  Object.assign(config, originalConfig);
  await rm(tempDir, { recursive: true, force: true });
}
