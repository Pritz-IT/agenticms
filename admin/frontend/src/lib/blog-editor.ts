import type { BlogPost, BlogPostInput, BlogTranslationInput } from "../api/types";
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
      Object.entries(translations).map(([locale, { updatedAt, url, ...fields }]) => [locale, fields])
    ),
  };
}

export function postSaveInput(
  draft: BlogPostInput,
  savedTranslations: Record<string, BlogTranslationInput>
): BlogPostInput {
  return {
    ...draft,
    translations: Object.fromEntries(Object.entries(draft.translations).filter(([locale, translation]) =>
      savedTranslations[locale] || translation.title || translation.slug || translation.body
    )),
  };
}

export function establishedSlugs(translations: Record<string, BlogTranslationInput>): Record<string, boolean> {
  return Object.fromEntries(Object.keys(translations).map((locale) => [locale, true]));
}

export function updateTranslationTitle(
  translation: BlogTranslationInput,
  title: string,
  slugEdited: boolean
): BlogTranslationInput {
  return { ...translation, title, slug: slugEdited ? translation.slug : slugify(title) };
}

export function stagingPostUrl(domain: string, url: string): string {
  return `https://${domain}${url}`;
}
