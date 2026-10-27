import type { BlogList } from "../components/visual-editor/agenticms-shims";

export async function resolveBlogPreviewCovers(
  lists: Record<string, BlogList>,
  fetchCover: (src: string) => Promise<string>,
) {
  const sources = [...new Set(Object.values(lists).flatMap((list) => list.posts
    .map((post) => post.coverImage).filter((src) => src.startsWith("/media/"))))];
  const results = await Promise.allSettled(sources.map(async (src) => fetchCover(src)));
  const covers = new Map<string, string>();
  const objectUrls: string[] = [];
  const failures: { src: string; error: unknown }[] = [];
  results.forEach((result, index) => {
    const src = sources[index];
    if (result.status === "fulfilled") {
      covers.set(src, result.value);
      objectUrls.push(result.value);
    } else {
      covers.set(src, "");
      failures.push({ src, error: result.reason });
    }
  });
  return {
    lists: Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, {
      ...list, posts: list.posts.map((post) => ({ ...post, coverImage: covers.get(post.coverImage) ?? post.coverImage })),
    }])),
    objectUrls,
    failures,
  };
}
