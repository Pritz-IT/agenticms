import { api } from "./client";
import type { BlogCategory, BlogTag, BlogPost, BlogPostInput } from "./types";

const blogPath = (siteKey: string) => `/api/sites/${encodeURIComponent(siteKey)}/blog`;
const postPath = (siteKey: string, key: string) => `${blogPath(siteKey)}/posts/${encodeURIComponent(key)}`;

export function fetchBlogCategories(siteKey: string): Promise<BlogCategory[]> {
  return api(`${blogPath(siteKey)}/categories`);
}

export function createBlogCategory(siteKey: string, data: BlogCategory): Promise<BlogCategory> {
  return api(`${blogPath(siteKey)}/categories`, { method: "POST", body: JSON.stringify(data) });
}

export function updateBlogCategory(siteKey: string, key: string, data: BlogCategory): Promise<BlogCategory> {
  return api(`${blogPath(siteKey)}/categories/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteBlogCategory(siteKey: string, key: string): Promise<{ ok: true }> {
  return api(`${blogPath(siteKey)}/categories/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export function fetchBlogTags(siteKey: string): Promise<BlogTag[]> {
  return api(`${blogPath(siteKey)}/tags`);
}

export function createBlogTag(siteKey: string, data: BlogTag): Promise<BlogTag> {
  return api(`${blogPath(siteKey)}/tags`, { method: "POST", body: JSON.stringify(data) });
}

export function updateBlogTag(siteKey: string, key: string, data: BlogTag): Promise<BlogTag> {
  return api(`${blogPath(siteKey)}/tags/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteBlogTag(siteKey: string, key: string): Promise<{ ok: true }> {
  return api(`${blogPath(siteKey)}/tags/${encodeURIComponent(key)}`, { method: "DELETE" });
}

export interface BlogPostFilters {
  category?: string;
  tag?: string;
  status?: "draft" | "published";
}

export function fetchBlogPosts(siteKey: string, filters: BlogPostFilters = {}): Promise<BlogPost[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return api(`${blogPath(siteKey)}/posts${params.size ? `?${params}` : ""}`);
}

export function fetchBlogPost(siteKey: string, key: string): Promise<BlogPost> {
  return api(postPath(siteKey, key));
}

export function createBlogPost(siteKey: string, data: BlogPostInput): Promise<BlogPost> {
  return api(`${blogPath(siteKey)}/posts`, { method: "POST", body: JSON.stringify(data) });
}

export function updateBlogPost(siteKey: string, key: string, data: BlogPostInput): Promise<BlogPost> {
  return api(postPath(siteKey, key), { method: "PUT", body: JSON.stringify(data) });
}

export function deleteBlogPost(siteKey: string, key: string): Promise<{ ok: true }> {
  return api(postPath(siteKey, key), { method: "DELETE" });
}

export async function uploadBlogPostMedia(siteKey: string, key: string, file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const result = await api<{ url: string }>(`${postPath(siteKey, key)}/media`, { method: "POST", body });
  return result.url;
}

export function publishBlogTranslation(siteKey: string, key: string, locale: string): Promise<BlogPost> {
  return api(`${postPath(siteKey, key)}/translations/${encodeURIComponent(locale)}/publish`, {
    method: "POST",
  });
}

export function unpublishBlogTranslation(siteKey: string, key: string, locale: string): Promise<BlogPost> {
  return api(`${postPath(siteKey, key)}/translations/${encodeURIComponent(locale)}/unpublish`, {
    method: "POST",
  });
}
