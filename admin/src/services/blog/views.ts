import type { Prisma } from "@prisma/client";
import { postUrlPath } from "./urls.js";

export interface BlogPostSummary {
  key: string;
  locale: string;
  url: string;
  title: string;
  excerpt: string;
  coverImage: string;
  publishedAt: string | null;
  category: { key: string; name: string };
  tags: { key: string; name: string }[];
}

export interface BlogPostView extends BlogPostSummary {
  body: string;
  metaTitle: string;
  metaDescription: string;
  translations: { locale: string; url: string }[];
}

export async function loadBlogPostViews(prisma: Prisma.TransactionClient, siteId: string, target: "staging" | "production"): Promise<BlogPostView[]> {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { defaultLocale: true } });
  const posts = await prisma.blogPost.findMany({
    where: { siteId, category: { page: { isPublished: true } } },
    include: {
      category: { include: { page: { select: { path: true } }, names: true } },
      tags: { include: { tag: { include: { names: true } } }, orderBy: { tag: { key: "asc" } } },
      translations: { where: { status: { in: target === "production" ? ["published"] : ["draft", "published"] } }, orderBy: { locale: "asc" } },
    },
    orderBy: { key: "asc" },
  });
  const named = (record: { key: string; names: { locale: string; name: string }[] }, locale: string) => ({
    key: record.key,
    name: record.names.find((entry) => entry.locale === locale)?.name
      ?? record.names.find((entry) => entry.locale === site.defaultLocale)?.name ?? record.key,
  });
  return posts.flatMap((post) => {
    const translations = post.translations.map(({ locale, slug }) => ({ locale, url: postUrlPath(post.category.page.path, locale, site.defaultLocale, slug) }));
    return post.translations.map(({ locale, slug, title, excerpt, coverImage, body, metaTitle, metaDescription }) => ({
      key: post.key, locale, url: postUrlPath(post.category.page.path, locale, site.defaultLocale, slug),
      title, excerpt, coverImage, body, metaTitle, metaDescription, publishedAt: post.publishedAt?.toISOString().slice(0, 10) ?? null,
      category: named(post.category, locale), tags: post.tags.map(({ tag }) => named(tag, locale)), translations,
    }));
  });
}
