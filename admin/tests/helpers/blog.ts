import type { FastifyInstance } from "fastify";

export async function createBlogFixture(app: FastifyInstance, siteId: string) {
  const page = await app.prisma.page.create({ data: { siteId, path: "/news" } });
  const layout = await app.prisma.layout.create({
    data: { siteId, name: "Post", filePath: "Post.tsx", kind: "post", detectedKeys: {} },
  });
  const category = await app.prisma.blogCategory.create({
    data: { siteId, key: "news", pageId: page.id, defaultLayoutId: layout.id },
  });
  const post = await app.prisma.blogPost.create({
    data: {
      siteId, key: "school-bus-routing", categoryId: category.id,
      translations: {
        create: [
          { categoryId: category.id, locale: "en", status: "draft", slug: "x", title: "English" },
          { categoryId: category.id, locale: "de", status: "published", slug: "x", title: "Deutsch" },
        ],
      },
    },
  });
  return { page, layout, category, post };
}
