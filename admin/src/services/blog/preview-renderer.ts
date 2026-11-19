import type { PrismaClient, Site } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { performance } from "perf_hooks";
import { config } from "../../config.js";
import { compileLayout, computeInputHash, type CompileLayoutError } from "../layout-compiler.js";
import { resolveSiteLayoutFile } from "../layout-paths.js";
import { loadSiteNavigation } from "../website-build/site-config.js";
import type { SiteConfig } from "../website-build/types.js";
import { requireLayoutOfKind } from "./layout-kind.js";
import { type PostInput, PostError, validatePostInput } from "./posts.js";
import { postUrlPath } from "./urls.js";
import { localizedName, type BlogPostView } from "./views.js";

export class PreviewRenderError extends Error {
  constructor(public readonly errors: CompileLayoutError[]) {
    super(errors.map((error) => error.text).join("; "));
    this.name = "PreviewRenderError";
  }
}

interface ServerLayoutModule {
  Layout: unknown;
  createElement: (type: unknown, props: Record<string, unknown>) => unknown;
  renderToString: (element: unknown) => string;
  documentHeadHtml: (props: unknown, config: SiteConfig, options: { content: Record<string, string>; defaultLocale: string; pathname: string }) => string;
}

// ponytail: every distinct layout version is a new ESM import that Node keeps for
// the process lifetime — a few KB per layout edit; a restart clears it.
const loaded = new Map<string, { inputHash: string; inputs: string[]; module: ServerLayoutModule }>();

async function loadServerLayout(layoutId: string, absPath: string, logger: FastifyBaseLogger): Promise<ServerLayoutModule> {
  const cached = loaded.get(layoutId);
  if (cached && await computeInputHash(cached.inputs).catch(() => null) === cached.inputHash) return cached.module;
  const started = performance.now();
  const compiled = await compileLayout(absPath, "server", resolve(config.ASTRO_PROJECT_DIR));
  if (!compiled.ok) throw new PreviewRenderError(compiled.errors);
  const dir = resolve(config.COMPILED_LAYOUTS_DIR);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `preview-${layoutId}-${compiled.inputHash.slice(0, 16)}.mjs`);
  await writeFile(file, compiled.code, "utf-8");
  const module = await import(pathToFileURL(file).href) as ServerLayoutModule;
  loaded.set(layoutId, { inputHash: compiled.inputHash, inputs: compiled.inputs, module });
  logger.info({ op: "blog.preview.compile", layoutId, inputs: compiled.inputs.length, ms: Math.round(performance.now() - started) }, "blog.preview.compile completed");
  return module;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Post media is admin-only; in a preview it is served through the token's own media
 * route. Rewritten on the finished HTML because the site's RichText sanitiser only
 * keeps /media/ and /assets/ image sources. Absolute URLs (og:image) stay untouched.
 * ponytail: a literal " /media/" in body text is rewritten too — preview-only, cosmetic.
 */
function rewritePreviewMedia(html: string, mediaPrefix: string): string {
  return html.replace(/(["'\s,(])\/media\//g, `$1${mediaPrefix}/`);
}

/**
 * Renders one locale of a post — the editor's unsaved state — exactly as the static
 * build would, without running a build. Validation (incl. rich-text sanitising) is
 * the save path's own, so a preview can never show markup a save would reject.
 */
export async function renderPostPreview(
  prisma: PrismaClient,
  site: Site,
  input: PostInput,
  locale: string,
  mediaPrefix: string,
  logger: FastifyBaseLogger,
): Promise<string> {
  const data = await validatePostInput(prisma, site, input, null, logger);
  const translation = data.translations.find((entry) => entry.locale === locale);
  if (!translation) throw new PostError(400, `Translation ${locale} is missing from the preview`);

  const [category, tags, locales, navigation] = await Promise.all([
    prisma.blogCategory.findUniqueOrThrow({ where: { id: data.categoryId }, include: { page: { select: { path: true } }, names: true } }),
    prisma.blogTag.findMany({ where: { id: { in: data.tags.map((tag) => tag.id) } }, include: { names: true }, orderBy: { key: "asc" } }),
    prisma.locale.findMany({ where: { siteId: site.id }, orderBy: { sortOrder: "asc" } }),
    loadSiteNavigation(prisma, site.id),
  ]);
  const layout = await requireLayoutOfKind(prisma, site.id, data.layoutId ?? category.defaultLayoutId, "post");
  const absPath = await resolveSiteLayoutFile(layout.filePath, site.key, resolve(config.LAYOUTS_DIR));
  if (!absPath) throw new PreviewRenderError([{ text: `Layout ${layout.filePath} is outside the layouts directory` }]);

  const urlFor = (entryLocale: string, slug: string) => postUrlPath(category.page.path, entryLocale, site.defaultLocale, slug);
  const post: BlogPostView & { layoutFilePath: string } = {
    key: data.key, locale, url: urlFor(locale, translation.slug),
    title: translation.title, excerpt: translation.excerpt,
    coverImage: translation.coverImage,
    body: translation.body,
    metaTitle: translation.metaTitle, metaDescription: translation.metaDescription,
    publishedAt: data.publishedAt?.toISOString().slice(0, 10) ?? null,
    category: localizedName(category, locale, site.defaultLocale),
    tags: tags.map((tag) => localizedName(tag, locale, site.defaultLocale)),
    // Same order as loadBlogPostViews (translations ordered by locale).
    translations: [...data.translations].sort((a, b) => a.locale.localeCompare(b.locale))
      .map((entry) => ({ locale: entry.locale, url: urlFor(entry.locale, entry.slug) })),
    layoutFilePath: layout.filePath,
  };
  const detectedKeys = (layout.detectedKeys ?? {}) as SiteConfig["layouts"][number]["detectedKeys"];
  const content = Object.fromEntries(Object.entries(detectedKeys).map(([key, value]) => [key, value.initial]));
  const siteConfig = {
    settings: site, locales, layouts: [layout], pages: [], navigation, stagingAccess: [], assets: [],
    buildTarget: "staging", posts: [post], blogLists: {},
  } as unknown as SiteConfig;
  // Same default-locale rule as website/src/lib/config.ts getDefaultLocale().
  const defaultLocale = locales.find((entry) => entry.isDefault)?.code ?? site.defaultLocale ?? "";

  const module = await loadServerLayout(layout.id, absPath, logger);
  let head: string;
  let body: string;
  try {
    head = module.documentHeadHtml({ kind: "post", post, locale }, siteConfig, { content, defaultLocale, pathname: post.url });
    body = module.renderToString(module.createElement(module.Layout, {
      post, content, blogLists: {},
      navigation: navigation.filter((entry) => entry.locale === locale),
      locale, locales, settings: site,
    }));
  } catch (error) {
    throw new PreviewRenderError([{ text: `Layout ${layout.filePath} failed to render: ${error instanceof Error ? error.message : String(error)}` }]);
  }
  return rewritePreviewMedia(`<!DOCTYPE html><html lang="${escapeAttr(locale)}"><head>${head}<script src="/preview/live.js" defer></script></head><body>${body}</body></html>`, mediaPrefix);
}
