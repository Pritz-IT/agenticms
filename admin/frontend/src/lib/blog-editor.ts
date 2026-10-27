import type { BlogPost, BlogPostInput, BlogTranslationInput } from "../api/types";
import { postUrlPath } from "../../../src/services/blog/urls";
import { slugify } from "./slugify";

export function emptyTranslation(): BlogTranslationInput {
  return {
    title: "",
    slug: "",
    excerpt: "",
    body: "",
    coverImage: null,
    metaTitle: "",
    metaDescription: "",
    status: "draft",
  };
}

export function postDraft(post: BlogPost): BlogPostInput {
  const { updatedAt, translations, ...shared } = post;
  return {
    ...shared,
    translations: Object.fromEntries(
      Object.entries(translations).map(([locale, { updatedAt, ...fields }]) => [locale, fields])
    ),
  };
}

export function updateTranslationTitle(
  translation: BlogTranslationInput,
  title: string,
  slugEdited: boolean
): BlogTranslationInput {
  return { ...translation, title, slug: slugEdited ? translation.slug : slugify(title) };
}

export function stagingPostUrl(
  domain: string,
  pagePath: string,
  locale: string,
  defaultLocale: string,
  slug: string
): string {
  return `https://${domain}${postUrlPath(pagePath, locale, defaultLocale, slug)}`;
}
