import type { SiteConfig } from "../../src/lib/site-config-types";

export function blogConfig(): SiteConfig {
  const posts: SiteConfig["posts"] = Array.from({ length: 25 }, (_, index) => ({
    key: `post-${index + 1}`, locale: "de", url: `/news/post-${index + 1}/`,
    title: `Post ${index + 1}`, excerpt: "Post excerpt", coverImage: "/media/post-1/cover.webp",
    publishedAt: null, category: { key: "news", name: "News" }, tags: [],
    body: "<p>Post body</p>", metaTitle: "Post SEO title", metaDescription: "Post SEO description",
    translations: [], layoutFilePath: "/layouts/FixturePost.tsx",
  }));
  posts.push({ ...posts[0], locale: "en", url: "/en/news/english-post/", title: "English post" });
  const layout = {
    id: "overview", name: "Overview", filePath: "/layouts/FixturePage.tsx",
    detectedKeys: {
      "_meta.title": { type: "text", initial: "News" },
      "_meta.description": { type: "text", initial: "News description" },
      articles: { type: "bloglist", initial: "" },
    },
    registeredAt: "", updatedAt: "",
  };
  return {
    buildTarget: "production", posts,
    blogLists: { news: {
      de: { articles: { postKeys: posts.filter((post) => post.locale === "de").map((post) => post.key), pageSize: 12 } },
      en: { articles: { postKeys: ["post-1"], pageSize: 12 } },
    } },
    settings: { id: "site", name: "Test Site", domain: "x", stagingDomain: "staging.x", defaultLocale: "de", siteUrl: "https://x" },
    locales: [
      { id: "de", code: "de", label: "Deutsch", isDefault: true, sortOrder: 0 },
      { id: "en", code: "en", label: "English", isDefault: false, sortOrder: 1 },
    ],
    layouts: [layout, {
      ...layout, id: "post", name: "Post", filePath: "/layouts/FixturePost.tsx",
      detectedKeys: { "footer.tagline": { type: "text", initial: "Post footer initial" } },
    }],
    pages: [{ id: "news", path: "/news", layoutId: layout.id, layout, contents: [], isPublished: true, sortOrder: 0 }],
    navigation: [], stagingAccess: [], assets: [],
  };
}
