import { Prisma, type PrismaClient, type Site } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { stat } from "node:fs/promises";
import { Parser } from "htmlparser2";
import { findImagesWithoutAlt, findSanitizerLoss, sanitizeRichTextValue } from "../../lib/content-sanitize.js";
import { LayoutKindError } from "./layout-kind.js";
import { detectImageType, PostMediaError, postMediaDiskPath, postMediaUrl, referencedMediaUrls, storePostMedia } from "./post-media.js";
import { listPosts, PostError, savePostInTx, validatePostInput, type PostDto, type PostInput } from "./posts.js";
import { assertNoRouteCollisions, collectSiteRoutes, lockSiteRoutes, RouteCollisionError } from "./route-lock.js";
import { postUrlPath } from "./urls.js";

export interface PushFile {
  source: string;
  key: string;
  locale: string;
  category: string;
  tags: string[];
  layout: string | null;
  title: string;
  slug: string;
  excerpt: string;
  cover: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  html: string;
}

interface PushIssue { source: string; problem: string; detail: string }
export class PostPushError extends Error {
  constructor(public readonly issues: PushIssue[]) {
    super("Post push rejected");
    this.name = "PostPushError";
  }
}

type PushSite = Pick<Site, "id" | "key" | "defaultLocale">;
type Upload = { name: string; bytes: Buffer };
type PushPost = { input: PostInput; files: PushFile[]; media: Map<string, Upload> };
type PushResult = { key: string; locale: string; action: "created" | "updated" | "unchanged" };

function reject(source: string, problem: string, detail: string): never {
  throw new PostPushError([{ source, problem, detail }]);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sharedChanged(a: PostInput, b: PostInput): boolean {
  return a.category !== b.category || a.layout !== b.layout || JSON.stringify([...new Set(a.tags)].sort()) !== JSON.stringify([...new Set(b.tags)].sort());
}
function validationError(error: unknown, source: string): PostPushError | null {
  if (error instanceof PostPushError) return error;
  if (error instanceof PostError || error instanceof PostMediaError || error instanceof LayoutKindError || error instanceof RouteCollisionError) {
    return new PostPushError([{ source, problem: "validation", detail: error.message }]);
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new PostPushError([{ source, problem: "collision", detail: "Post key or translation slug is already in use" }]);
  }
  return null;
}

function preparePush(body: unknown): { draft: boolean; posts: PushPost[]; files: PushFile[] } {
  if (!isRecord(body) || typeof body.draft !== "boolean" || !Array.isArray(body.files) || !Array.isArray(body.media)) {
    reject("push", "body", "Expected draft boolean, files array and media array");
  }
  const uploads = new Map<string, Upload>();
  for (const item of body.media) {
    if (!isRecord(item) || typeof item.ref !== "string" || !item.ref || typeof item.name !== "string" || !item.name || typeof item.base64 !== "string") {
      reject("push", "media", "Each media item requires ref, name and base64 strings");
    }
    const source = body.files.find((file) => isRecord(file) && (file.cover === item.ref || (typeof file.html === "string" && file.html.includes(item.ref as string))))?.source;
    const mediaSource = typeof source === "string" ? source : item.ref;
    if (uploads.has(item.ref)) reject(mediaSource, "media", `Duplicate media ref: ${item.ref}`);
    const bytes = Buffer.from(item.base64, "base64");
    if (!item.base64 || bytes.toString("base64") !== item.base64) {
      reject(mediaSource, "media", `Invalid base64 for ${item.ref}`);
    }
    if (!detectImageType(bytes)) reject(mediaSource, "media", `Unsupported image type for ${item.ref}; use PNG, JPEG, WebP or GIF`);
    uploads.set(item.ref, { name: item.name, bytes });
  }
  const posts = new Map<string, PushPost>();
  const files: PushFile[] = [];
  for (const raw of body.files) {
    const source = isRecord(raw) && typeof raw.source === "string" ? raw.source : "push";
    const textFields = ["source", "key", "locale", "category", "title", "slug", "excerpt", "html"];
    const nullableFields = ["layout", "cover", "metaTitle", "metaDescription"];
    if (!isRecord(raw) || textFields.some((field) => typeof raw[field] !== "string")
      || nullableFields.some((field) => raw[field] !== null && typeof raw[field] !== "string")
      || !Array.isArray(raw.tags) || raw.tags.some((tag) => typeof tag !== "string")
      || Object.keys(raw).some((field) => ![...textFields, ...nullableFields, "tags"].includes(field))) {
      reject(source, "file", "Invalid file fields; expected string content, tags array and nullable layout/cover/meta fields");
    }
    const file = raw as unknown as PushFile;
    const input: PostInput = { key: file.key, category: file.category, tags: file.tags, layout: file.layout, translations: Object.create(null) };
    let post = posts.get(file.key);
    if (post) {
      if (sharedChanged(post.input, input)) reject(source, "shared fields", `Conflicting category, tags or layout for post ${file.key}`);
      if (post.files.some((entry) => entry.locale === file.locale)) reject(source, "translation", `Duplicate key/locale: ${file.key}/${file.locale}`);
    } else {
      post = { input, files: [], media: new Map() };
      posts.set(file.key, post);
    }
    const rewrite = (ref: string): string => {
      if (ref.startsWith("/assets/") || ref.startsWith("/media/")) return ref;
      const upload = uploads.get(ref);
      if (!upload || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(ref)) reject(source, "media", `Missing local media ref or unsupported image source: ${ref}`);
      const url = postMediaUrl(file.key, upload.name, upload.bytes);
      post.media.set(ref, upload);
      return url;
    };
    // Replace only image src attributes, preserving raw markup for the loss check.
    const replacements: { start: number; end: number; value: string }[] = [];
    let tag = "";
    const parser = new Parser({
      onopentagname(name) { tag = name; },
      onattribute(name, value) {
        if (tag === "img" && name === "src") {
          const url = rewrite(value);
          if (url !== value) replacements.push({ start: parser.startIndex, end: parser.endIndex, value: `src="${url}"` });
        }
      },
    });
    try {
      parser.end(file.html);
      let html = file.html;
      for (const replacement of replacements.reverse()) html = html.slice(0, replacement.start) + replacement.value + html.slice(replacement.end);
      const cover = file.cover ? rewrite(file.cover) : null;
      const sanitized = sanitizeRichTextValue(html);
      const issues: PushIssue[] = findSanitizerLoss(html, sanitized).map((loss) => ({
        source, problem: "sanitizer loss", detail: `Removed ${loss.element}${loss.attribute ? ` ${loss.attribute}=${JSON.stringify(loss.value)}` : ""}`,
      }));
      for (const src of findImagesWithoutAlt(html)) issues.push({ source, problem: "alt", detail: `Image requires alt text: ${src}` });
      if (issues.length) throw new PostPushError(issues);
      post.input.translations[file.locale] = {
        slug: file.slug, title: file.title, excerpt: file.excerpt, body: sanitized, coverImage: cover,
        metaTitle: file.metaTitle ?? "", metaDescription: file.metaDescription ?? "",
      };
    } catch (error) {
      throw validationError(error, source) ?? error;
    }
    post.files.push(file);
    files.push(file);
  }
  return { draft: body.draft, posts: [...posts.values()], files };
}

async function validateBatch(tx: Prisma.TransactionClient, site: PushSite, posts: PushPost[], draft: boolean) {
  const existing = new Map((await listPosts(tx, site)).map((post) => [post.key, post]));
  const categories = await tx.blogCategory.findMany({ where: { siteId: site.id }, include: { page: { select: { path: true } } } });
  let routes = await collectSiteRoutes(tx, site.id);
  const inputs: PostInput[] = [];
  for (const post of posts) {
    let source = post.files[0].source;
    try {
      const old = existing.get(post.input.key);
      const input: PostInput = { ...post.input, translations: { ...post.input.translations } };
      const sharedChange = old !== undefined && sharedChanged(old, input);
      for (const [locale, translation] of Object.entries(input.translations)) {
        source = post.files.find((file) => file.locale === locale)!.source;
        const data = await validatePostInput(tx, site, { ...input, translations: { [locale]: translation } });
        // Compare the same normalized content that savePostInTx persists, excluding publication state.
        const { locale: validatedLocale, categoryId, status, ...fields } = data.translations[0];
        const before = old?.translations[locale];
        const changed = !before || Object.entries(fields).some(([field, value]) => before[field as keyof typeof fields] !== value);
        if (changed && before?.status === "published" && !draft) {
          reject(source, "published", `Translation ${input.key}/${locale} is published; use draft: true`);
        }
        if (changed && draft) input.translations[locale] = { ...translation, status: "draft" };
      }
      source = post.files[0].source;
      if (sharedChange && !draft && Object.values(old.translations).some((entry) => entry.status === "published")) {
        reject(source, "published", `Shared fields of live post ${input.key} require draft: true`);
      }
      if (sharedChange && draft) {
        for (const [locale, translation] of Object.entries(old?.translations ?? {})) {
          if (translation.status === "published") {
            const { updatedAt, url, ...fields } = translation;
            input.translations[locale] = { ...fields, ...input.translations[locale], status: "draft" };
          }
        }
      }
      source = post.files[0].source;
      const category = categories.find((entry) => entry.key === input.category)!;
      routes = routes.filter((route) => !route.owner.startsWith(`post ${input.key} (`));
      for (const [locale, translation] of Object.entries({ ...old?.translations, ...input.translations })) {
        routes.push({ url: postUrlPath(category.page.path, locale, site.defaultLocale, translation.slug), owner: `post ${input.key} (${locale})` });
      }
      assertNoRouteCollisions(routes);
      inputs.push(input);
    } catch (error) {
      // Always rethrow: a database failure makes the entire transaction unusable.
      throw validationError(error, source) ?? error;
    }
  }
  return { existing, inputs };
}

function actionFor(old: PostDto | undefined, saved: PostDto, locale: string): PushResult["action"] {
  const before = old?.translations[locale];
  if (!old || !before) return "created";
  const after = saved.translations[locale];
  return sharedChanged(old, saved) || Object.keys(after).some((field) => field !== "updatedAt" && before[field as keyof typeof before] !== after[field as keyof typeof after])
    ? "updated" : "unchanged";
}

export async function pushPosts(prisma: PrismaClient, site: PushSite, body: unknown, log: FastifyBaseLogger): Promise<{ posts: PushResult[] }> {
  const context = { op: "blog.push", site: site.key, fileCount: isRecord(body) && Array.isArray(body.files) ? body.files.length : 0, draft: isRecord(body) ? body.draft === true : false };
  log.info(context, "blog.push requested");
  let source = "push";
  try {
    const prepared = preparePush(body);
    for (const file of prepared.files) {
      source = file.source;
      for (const src of referencedMediaUrls(file.html, file.cover)) {
        const diskPath = postMediaDiskPath(site.key, src);
        if (!diskPath || !src.startsWith(`/media/${file.key}/`)) reject(source, "media", `Invalid post media: ${src}`);
        try {
          if (!(await stat(diskPath)).isFile()) reject(source, "media", `Missing post media: ${src}`);
        } catch (error) {
          if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) reject(source, "media", `Missing post media: ${src}`);
          throw error;
        }
      }
    }
    await validateBatch(prisma, site, prepared.posts, prepared.draft);
    for (const post of prepared.posts) {
      source = post.files[0].source;
      for (const upload of post.media.values()) await storePostMedia(site.key, post.input.key, upload.name, upload.bytes, log);
    }
    const result = await prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, site.id);
      // Recheck mutable state under the lock so concurrent publishing cannot bypass the guards.
      const { existing, inputs } = await validateBatch(tx, site, prepared.posts, prepared.draft);
      const saved = new Map<string, PostDto>();
      for (const input of inputs) {
        source = prepared.posts.find((post) => post.input.key === input.key)!.files[0].source;
        saved.set(input.key, await savePostInTx(tx, site, input, log));
      }
      const changed = [...saved].some(([key, post]) => Object.keys(post.translations).some((locale) => actionFor(existing.get(key), post, locale) !== "unchanged"));
      return { changed, posts: prepared.files.map(({ key, locale }) => ({ key, locale, action: actionFor(existing.get(key), saved.get(key)!, locale) })) };
    }, { timeout: 15000 });
    log.info({ ...context, posts: result.posts }, result.changed ? "blog.push committed" : "blog.push NO-OP — unchanged");
    return { posts: result.posts };
  } catch (error) {
    const rejection = validationError(error, source);
    if (rejection) {
      log.warn({ ...context, issues: rejection.issues }, "blog.push rejected");
      log.info(context, "blog.push NO-OP — rejected");
      throw rejection;
    }
    log.error({ ...context, err: error }, "blog.push failed");
    log.info(context, "blog.push NO-OP — no posts committed");
    throw error;
  }
}
