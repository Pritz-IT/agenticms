import { afterAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
afterAll(async () => { await prisma.$disconnect(); });

it("enforces blog constraints and cascades a site deletion through all blog models", async () => {
  const site = await prisma.site.create({
    data: { key: "blog-schema", name: "Blog", domain: "blog.test", stagingDomain: "staging.blog.test", defaultLocale: "en" },
  });
  const layout = await prisma.layout.create({
    data: { siteId: site.id, name: "Post", filePath: "Post.tsx" },
  });
  expect(layout.kind).toBe("page");
  const override = await prisma.layout.create({
    data: { siteId: site.id, name: "Override", filePath: "Override.tsx", kind: "post" },
  });
  const page = await prisma.page.create({ data: { siteId: site.id, path: "/news" } });
  const category = await prisma.blogCategory.create({
    data: {
      siteId: site.id, key: "news", pageId: page.id, defaultLayoutId: layout.id,
      names: { create: { locale: "en", name: "News" } },
    },
  });
  const tag = await prisma.blogTag.create({
    data: { siteId: site.id, key: "updates", names: { create: { locale: "en", name: "Updates" } } },
  });
  const post = await prisma.blogPost.create({
    data: {
      siteId: site.id, key: "first", categoryId: category.id, layoutId: override.id,
      tags: { create: { tagId: tag.id } },
      translations: { create: { categoryId: category.id, locale: "en", slug: "first", title: "First" } },
    },
    include: { translations: true },
  });
  expect(post.publishedAt).toBeNull();
  expect(post.createdAt).toBeInstanceOf(Date);
  expect(post.updatedAt).toBeInstanceOf(Date);
  expect(post.translations[0]).toMatchObject({ status: "draft", updatedAt: expect.any(Date) });

  await expect(prisma.blogCategory.create({
    data: { siteId: site.id, key: "other", pageId: page.id, defaultLayoutId: layout.id },
  })).rejects.toMatchObject({ code: "P2002" });
  await expect(prisma.blogPost.create({
    data: { siteId: site.id, key: "first", categoryId: category.id },
  })).rejects.toMatchObject({ code: "P2002" });
  await expect(prisma.blogPostTag.create({
    data: { postId: post.id, tagId: tag.id },
  })).rejects.toMatchObject({ code: "P2002" });
  await expect(prisma.blogPostTranslation.create({
    data: { postId: post.id, categoryId: category.id, locale: "en", slug: "other", title: "Duplicate locale" },
  })).rejects.toMatchObject({ code: "P2002" });
  const other = await prisma.blogPost.create({
    data: { siteId: site.id, key: "other", categoryId: category.id },
  });
  await expect(prisma.blogPostTranslation.create({
    data: { postId: other.id, categoryId: category.id, locale: "en", slug: "first", title: "Duplicate URL" },
  })).rejects.toMatchObject({ code: "P2002" });

  await expect(prisma.page.delete({ where: { id: page.id } })).rejects.toMatchObject({ code: "P2003" });
  await expect(prisma.layout.delete({ where: { id: layout.id } })).rejects.toMatchObject({ code: "P2003" });
  await expect(prisma.layout.delete({ where: { id: override.id } })).rejects.toMatchObject({ code: "P2003" });
  await expect(prisma.blogCategory.delete({ where: { id: category.id } })).rejects.toMatchObject({ code: "P2003" });

  await prisma.site.delete({ where: { id: site.id } });
  for (const model of [prisma.blogCategory, prisma.blogCategoryName, prisma.blogTag, prisma.blogTagName,
    prisma.blogPost, prisma.blogPostTag, prisma.blogPostTranslation]) {
    expect(await model.count()).toBe(0);
  }
});
