import { Prisma, type PrismaClient, type Site } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { log } from "../../logging.js";
import { findImagesWithoutAlt, sanitizeRichTextValue } from "../../lib/content-sanitize.js";
import { LayoutKindError, requireLayoutOfKind } from "./layout-kind.js";
import { assertNoRouteCollisions, collectSiteRoutes, lockSiteRoutes, RouteCollisionError } from "./route-lock.js";

export interface PostTranslationInput {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImage: string | null;
  metaTitle: string;
  metaDescription: string;
  status?: "draft" | "published";
}

export interface PostInput {
  key: string;
  category: string;
  tags: string[];
  layout: string | null;
  publishedAt?: string | null;
  translations: Record<string, PostTranslationInput>;
}

export interface PostDto extends Omit<PostInput, "publishedAt" | "translations"> {
  publishedAt: string | null;
  updatedAt: string;
  translations: Record<string, PostTranslationInput & { status: "draft" | "published"; updatedAt: string }>;
}

export class PostError extends Error {
  constructor(public readonly statusCode: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "PostError";
  }
}

type PostSite = Pick<Site, "id">;
type SaveMode = "upsert" | "create" | "update";
const keyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const postInclude = {
  category: { select: { key: true } }, layout: { select: { name: true } },
  tags: { include: { tag: { select: { key: true } } } }, translations: { orderBy: { locale: "asc" } },
} as const;
type PostRecord = Prisma.BlogPostGetPayload<{ include: typeof postInclude }>;

function serialize(post: PostRecord): PostDto {
  return {
    key: post.key, category: post.category.key, tags: post.tags.map(({ tag }) => tag.key).sort(),
    layout: post.layout?.name ?? null, publishedAt: post.publishedAt?.toISOString().slice(0, 10) ?? null,
    updatedAt: post.updatedAt.toISOString(),
    translations: Object.fromEntries(post.translations.map(({ locale, slug, title, excerpt, body, coverImage, metaTitle, metaDescription, status, updatedAt }) => [
      locale, { slug, title, excerpt, body, coverImage, metaTitle, metaDescription, status, updatedAt: updatedAt.toISOString() },
    ])),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectMutation(error: unknown, context: object, logger: FastifyBaseLogger): never {
  const rejection = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
    ? new PostError(409, "Post key or translation slug is already in use in this category and locale") : error;
  if (rejection instanceof PostError || rejection instanceof LayoutKindError || rejection instanceof RouteCollisionError) {
    logger.warn({ ...context, err: rejection }, "blog post mutation rejected");
    logger.info(context, "blog post mutation NO-OP — rejected");
  } else {
    logger.error({ ...context, err: error }, "blog post mutation failed");
    logger.info(context, "blog post mutation NO-OP — transaction must roll back");
  }
  throw rejection;
}

async function postTransaction<T>(
  prisma: PrismaClient, site: PostSite, context: object, logger: FastifyBaseLogger,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  logger.info(context, "blog post mutation requested");
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, site.id);
      return work(tx);
    }, { timeout: 15000 });
    logger.info(context, "blog post mutation committed");
    return result;
  } catch (error) {
    return rejectMutation(error, context, logger);
  }
}

export async function getPost(prisma: Prisma.TransactionClient, site: PostSite, key: string): Promise<PostDto> {
  const post = await prisma.blogPost.findUnique({ where: { siteId_key: { siteId: site.id, key } }, include: postInclude });
  if (!post) throw new PostError(404, "Post not found");
  return serialize(post);
}

export async function listPosts(prisma: Prisma.TransactionClient, site: PostSite, filters: { category?: string; tag?: string; status?: string } = {}): Promise<PostDto[]> {
  for (const [field, value] of Object.entries(filters)) {
    if (value !== undefined && (typeof value !== "string" || !["category", "tag", "status"].includes(field))) throw new PostError(400, "Invalid post filter");
  }
  const { category, tag, status } = filters;
  if (status && status !== "draft" && status !== "published") throw new PostError(400, "status must be draft or published");
  const posts = await prisma.blogPost.findMany({
    where: {
      siteId: site.id, ...(category && { category: { key: category } }),
      ...(tag && { tags: { some: { tag: { key: tag } } } }),
      ...((status === "draft" || status === "published") && { translations: { some: { status } } }),
    },
    include: postInclude, orderBy: [{ updatedAt: "desc" }, { key: "asc" }],
  });
  return posts.map(serialize);
}

export async function validatePostInput(tx: Prisma.TransactionClient, site: PostSite, input: unknown, existing: PostRecord | null = null) {
  if (!isRecord(input)) throw new PostError(400, "Body must be an object");
  if (Object.keys(input).some((field) => !["key", "category", "tags", "layout", "publishedAt", "translations"].includes(field))) throw new PostError(400, "Unknown post field");
  if (typeof input.key !== "string" || !keyPattern.test(input.key)) throw new PostError(400, "key must contain lowercase letters, digits and single hyphens");
  if (typeof input.category !== "string") throw new PostError(400, "category must be a key");
  const category = await tx.blogCategory.findUnique({ where: { siteId_key: { siteId: site.id, key: input.category } } });
  if (!category) throw new PostError(400, "Category not found for this site");
  if (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string" || !keyPattern.test(tag))) throw new PostError(400, "tags must be an array of keys");
  const tagKeys = [...new Set(input.tags as string[])];
  const tags = await tx.blogTag.findMany({ where: { siteId: site.id, key: { in: tagKeys } } });
  if (tags.length !== tagKeys.length) throw new PostError(400, "Tag not found for this site");
  let layoutId: string | null = null;
  if (input.layout !== null) {
    if (typeof input.layout !== "string" || !input.layout.trim()) throw new PostError(400, "layout must be a post layout name or null");
    const layouts = await tx.layout.findMany({ where: { siteId: site.id, name: input.layout, kind: "post" }, select: { id: true }, take: 2 });
    if (layouts.length !== 1) throw new PostError(400, layouts.length ? "Post layout name is ambiguous" : "Post layout not found for this site");
    layoutId = (await requireLayoutOfKind(tx, site.id, layouts[0].id, "post")).id;
  }
  let publishedAt = existing?.publishedAt ?? null;
  if (input.publishedAt !== undefined) {
    if (input.publishedAt === null) publishedAt = null;
    else {
      if (typeof input.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.publishedAt)) throw new PostError(400, "publishedAt must be a YYYY-MM-DD date or null");
      publishedAt = new Date(`${input.publishedAt}T00:00:00.000Z`);
      if (!Number.isFinite(publishedAt.getTime()) || publishedAt.toISOString().slice(0, 10) !== input.publishedAt) throw new PostError(400, "publishedAt must be a valid date");
    }
  }
  if (!isRecord(input.translations)) throw new PostError(400, "translations must be a locale-to-translation object");
  const locales = await tx.locale.findMany({ where: { siteId: site.id }, select: { code: true } });
  const translations = Object.entries(input.translations).map(([locale, value]) => {
    if (!locales.some(({ code }) => code === locale)) throw new PostError(400, `Locale ${locale} is not configured for this site`);
    const textFields = ["slug", "title", "excerpt", "body", "metaTitle", "metaDescription"] as const;
    if (!isRecord(value) || textFields.some((field) => typeof value[field] !== "string")) throw new PostError(400, `Translation ${locale} requires string content fields`);
    if (Object.keys(value).some((field) => ![...textFields, "coverImage", "status"].includes(field))) throw new PostError(400, `Unknown translation field for ${locale}`);
    const fields = value as unknown as PostTranslationInput;
    if (!keyPattern.test(fields.slug)) throw new PostError(400, `Invalid slug for ${locale}`);
    if (fields.status !== undefined && fields.status !== "draft" && fields.status !== "published") throw new PostError(400, `Invalid status for ${locale}`);
    if (fields.coverImage !== null && (typeof fields.coverImage !== "string" || (fields.coverImage !== "" && !fields.coverImage.startsWith("/assets/") && !fields.coverImage.startsWith("/media/")))) throw new PostError(400, `coverImage for ${locale} must start with /assets/ or /media/`);
    const missingAlt = findImagesWithoutAlt(fields.body);
    if (missingAlt.length) throw new PostError(400, `Images require alt text (${locale}): ${missingAlt.join(", ")}`);
    return {
      locale, categoryId: category.id, slug: fields.slug, title: fields.title, excerpt: fields.excerpt,
      body: sanitizeRichTextValue(fields.body), coverImage: fields.coverImage ?? "", metaTitle: fields.metaTitle, metaDescription: fields.metaDescription,
      status: fields.status ?? existing?.translations.find((entry) => entry.locale === locale)?.status ?? "draft",
    };
  });
  const becomesPublished = translations.some((entry) => entry.status === "published" && existing?.translations.find((old) => old.locale === entry.locale)?.status !== "published");
  if (publishedAt === null && becomesPublished) publishedAt = new Date(new Date().toISOString().slice(0, 10));
  return { key: input.key, categoryId: category.id, tags, layoutId, publishedAt, translations };
}

// Caller owns the transaction and must already hold lockSiteRoutes; errors must roll it back. Each save checks collisions.
export async function savePostInTx(tx: Prisma.TransactionClient, site: PostSite, input: PostInput, logger: FastifyBaseLogger = log, mode: SaveMode = "upsert"): Promise<PostDto> {
  const context = { op: "blog.post.saveInTx", siteId: site.id, key: isRecord(input) && typeof input.key === "string" ? input.key : undefined };
  logger.info(context, "blog.post.saveInTx requested");
  try {
    if (!isRecord(input) || typeof input.key !== "string") throw new PostError(400, "key must be a string");
    const where = { siteId_key: { siteId: site.id, key: input.key } };
    const existing = await tx.blogPost.findUnique({ where, include: postInclude });
    if (mode === "create" && existing) throw new PostError(409, "Post key is already in use");
    if (mode === "update" && !existing) throw new PostError(404, "Post not found");
    const data = await validatePostInput(tx, site, input, existing);
    const changedTranslations = data.translations.filter((entry) => {
      const old = existing?.translations.find((value) => value.locale === entry.locale);
      return !old || Object.entries(entry).some(([field, value]) => old[field as keyof typeof entry] !== value);
    });
    const tagsChanged = !existing || existing.tags.length !== data.tags.length || data.tags.some((tag) => !existing.tags.some((entry) => entry.tagId === tag.id));
    const changed = !existing || existing.categoryId !== data.categoryId || existing.layoutId !== data.layoutId
      || existing.publishedAt?.getTime() !== data.publishedAt?.getTime() || tagsChanged || changedTranslations.length > 0;
    let saved = existing;
    if (changed) {
      const shared = { categoryId: data.categoryId, layoutId: data.layoutId, publishedAt: data.publishedAt };
      const post = existing
        ? await tx.blogPost.update({ where, data: shared })
        : await tx.blogPost.create({ data: { ...shared, siteId: site.id, key: data.key } });
      if (tagsChanged) {
        await tx.blogPostTag.deleteMany({ where: { postId: post.id } });
        await tx.blogPostTag.createMany({ data: data.tags.map((tag) => ({ postId: post.id, tagId: tag.id })) });
      }
      for (const entry of changedTranslations) {
        await tx.blogPostTranslation.upsert({
          where: { postId_locale: { postId: post.id, locale: entry.locale } },
          create: { ...entry, postId: post.id }, update: entry,
        });
      }
      if (existing && existing.categoryId !== data.categoryId) {
        await tx.blogPostTranslation.updateMany({ where: { postId: post.id, categoryId: { not: data.categoryId } }, data: { categoryId: data.categoryId } });
      }
      saved = await tx.blogPost.findUniqueOrThrow({ where, include: postInclude });
    }
    assertNoRouteCollisions(await collectSiteRoutes(tx, site.id));
    logger.info(context, changed ? "blog.post.saveInTx saved in transaction" : "blog.post.saveInTx NO-OP — unchanged");
    return serialize(saved!);
  } catch (error) {
    return rejectMutation(error, context, logger);
  }
}

export async function savePost(prisma: PrismaClient, site: PostSite, input: PostInput, logger: FastifyBaseLogger = log, mode: SaveMode = "upsert"): Promise<PostDto> {
  return postTransaction(prisma, site, { op: "blog.post.save", siteId: site.id }, logger, (tx) => savePostInTx(tx, site, input, logger, mode));
}

export async function setPostTranslationStatus(prisma: PrismaClient, site: PostSite, key: string, locale: string, status: "draft" | "published", logger: FastifyBaseLogger = log): Promise<PostDto> {
  const context = { op: `blog.post.${status === "published" ? "publish" : "unpublish"}`, siteId: site.id, key, locale };
  return postTransaction(prisma, site, context, logger, async (tx) => {
    const post = await getPost(tx, site, key);
    const translation = post.translations[locale];
    if (!translation) throw new PostError(404, `Post translation ${locale} not found`);
    if (translation.status === status) {
      logger.info(context, "blog post status NO-OP — unchanged");
      return post;
    }
    const { updatedAt, ...fields } = translation;
    return savePostInTx(tx, site, {
      key, category: post.category, tags: post.tags, layout: post.layout,
      translations: { [locale]: { ...fields, status } },
    }, logger, "update");
  });
}

export async function deletePost(prisma: PrismaClient, site: PostSite, key: string, logger: FastifyBaseLogger = log) {
  return postTransaction(prisma, site, { op: "blog.post.delete", siteId: site.id, key }, logger, async (tx) => {
    const result = await tx.blogPost.deleteMany({ where: { siteId: site.id, key } });
    if (!result.count) throw new PostError(404, "Post not found");
    return { ok: true };
  });
}
