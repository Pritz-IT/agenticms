import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { promises as fs } from "node:fs";
import { requireSite } from "../services/sites.js";
import { LayoutKindError } from "../services/blog/layout-kind.js";
import { RouteCollisionError } from "../services/blog/route-lock.js";
import { listBlogMasterdata, MasterdataError, mutateBlogMasterdata } from "../services/blog/masterdata.js";
import { sendRouteCollision } from "./route-collision.js";
import { deletePost, getPost, listPosts, PostError, type PostInput, savePost, setPostTranslationStatus } from "../services/blog/posts.js";
import { detectImageType, PostMediaError, postMediaDiskPath, storePostMedia } from "../services/blog/post-media.js";

import { BlogListFilterError, blogListDefaults, parseBlogListFilter, resolveBlogList, type BlogList } from "../services/blog/bloglist.js";
import { loadBlogPostViews } from "../services/blog/views.js";
import { paginate } from "../services/blog/pagination.js";
import { pageRouteSlug, slugToUrlPath } from "../services/blog/urls.js";

export async function registerSiteBlogRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.addHook("onRequest", app.authenticate);

  app.get<{ Params: { siteKey: string; pageId: string }; Querystring: { locale?: string; page?: string } }>("/:siteKey/pages/:pageId/blog-lists", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const page = await app.prisma.page.findFirst({ where: { id: request.params.pageId, siteId: site.id }, include: { layout: true } });
    if (!page) return reply.status(404).send({ error: "Page not found" });
    const locale = request.query.locale ?? site.defaultLocale;
    if (typeof locale !== "string" || !await app.prisma.locale.findUnique({ where: { siteId_code: { siteId: site.id, code: locale } } })) {
      return reply.status(400).send({ error: "Locale is not configured for this site" });
    }
    const pageParam = request.query.page ?? "1";
    if (typeof pageParam !== "string" || !/^[1-9]\d*$/.test(pageParam) || !Number.isSafeInteger(Number(pageParam))) {
      return reply.status(400).send({ error: "page must be a positive integer" });
    }
    try {
      const contents = await app.prisma.content.findMany({ where: { pageId: page.id, locale: site.defaultLocale } });
      const posts = await loadBlogPostViews(app.prisma, site.id, "staging");
      const basePath = slugToUrlPath(pageRouteSlug(page.path, locale, site.defaultLocale));
      const lists: Record<string, BlogList> = {};
      for (const [key, initial] of Object.entries(blogListDefaults(page.layout?.detectedKeys))) {
        const filter = parseBlogListFilter(contents.find((content) => content.key === key)?.value ?? initial);
        const matched = resolveBlogList(posts, filter, locale)
          .map(({ body, metaTitle, metaDescription, translations, ...summary }) => summary);
        if (filter.pageSize === null) lists[key] = { posts: matched, pagination: null };
        else {
          const result = paginate(matched, filter.pageSize, Number(pageParam), basePath);
          lists[key] = { posts: result.items, pagination: result.pagination };
        }
      }
      return reply.send(lists);
    } catch (error) {
      if (error instanceof BlogListFilterError || error instanceof RangeError) {
        request.log.warn({ op: "blog.preview", siteId: site.id, pageId: page.id, err: error }, "blog preview rejected");
        return reply.status(error instanceof BlogListFilterError ? 400 : 404).send({ error: error.message });
      }
      request.log.error({ op: "blog.preview", siteId: site.id, pageId: page.id, err: error }, "blog preview failed");
      throw error;
    }
  });

  app.get<{ Params: { siteKey: string; "*": string } }>("/:siteKey/blog/media/*", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const diskPath = postMediaDiskPath(site.key, `/media/${request.params["*"]}`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, no-store");
    if (!diskPath) return reply.status(404).send({ error: "Post media not found" });
    try {
      const buffer = await fs.readFile(diskPath);
      const type = detectImageType(buffer);
      if (!type) {
        request.log.warn({ op: "blog.media.read", siteKey: site.key }, "blog.media.read rejected — unsupported stored image");
        return reply.status(404).send({ error: "Post media not found" });
      }
      return reply.type(`image/${type}`).send(buffer);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        request.log.warn({ op: "blog.media.read", siteKey: site.key, err: error }, "blog.media.read missing");
        return reply.status(404).send({ error: "Post media not found" });
      }
      request.log.error({ op: "blog.media.read", siteKey: site.key, err: error }, "blog.media.read failed");
      throw error;
    }
  });

  app.post<{ Params: { siteKey: string; key: string } }>("/:siteKey/blog/posts/:key/media", async (request, reply) => {
    const { siteKey, key } = request.params;
    const context = { op: "blog.media.upload", siteKey, postKey: key };
    request.log.info(context, "blog.media.upload requested");
    try {
      const site = await requireSite(app, siteKey);
      const post = await app.prisma.blogPost.findUnique({ where: { siteId_key: { siteId: site.id, key } }, select: { key: true } });
      if (!post) throw new PostMediaError(404, "Post not found");
      const data = await request.file();
      if (!data) throw new PostMediaError(400, "No file uploaded");
      // The multipart buffer reader rejects truncated uploads at the asset route's 10 MiB limit.
      const buffer = await data.toBuffer();
      const url = await storePostMedia(site.key, post.key, data.filename, buffer, request.log);
      request.log.info(context, "blog.media.upload completed");
      return reply.status(201).send({ url });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode && statusCode < 500) {
        request.log.warn({ ...context, err: error }, "blog.media.upload rejected");
        request.log.info(context, "blog.media.upload NO-OP — rejected");
      } else {
        request.log.error({ ...context, err: error }, "blog.media.upload failed");
        request.log.info(context, "blog.media.upload failed to complete");
      }
      if (error instanceof PostMediaError) return reply.status(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.get<{ Params: { siteKey: string }; Querystring: { category?: string; tag?: string; status?: string } }>("/:siteKey/blog/posts", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    try {
      return reply.send(await listPosts(app.prisma, site, request.query));
    } catch (error) {
      if (error instanceof PostError) return reply.status(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  for (const [method, action] of [["GET", "get"], ["POST", "create"], ["PUT", "update"], ["DELETE", "delete"], ["POST", "publish"], ["POST", "unpublish"]] as const) {
    const statusAction = action === "publish" || action === "unpublish";
    app.route<{ Params: { siteKey: string; key: string; locale: string }; Body: PostInput }>({
      method,
      url: `/:siteKey/blog/posts${action === "create" ? "" : "/:key"}${statusAction ? `/translations/:locale/${action}` : ""}`,
      handler: async (request, reply) => {
        const site = await requireSite(app, request.params.siteKey);
        const { key, locale } = request.params;
        try {
          if (action === "get") return reply.send(await getPost(app.prisma, site, key));
          if (action === "delete") return reply.send(await deletePost(app.prisma, site, key, request.log));
          if (statusAction) return reply.send(await setPostTranslationStatus(app.prisma, site, key, locale, action === "publish" ? "published" : "draft", request.log));
          if (action === "update" && request.body?.key !== key) {
            const context = { op: "blog.post.update", siteId: site.id, key };
            request.log.info(context, "blog.post.update requested");
            request.log.warn(context, "blog.post.update rejected — key cannot be changed");
            request.log.info(context, "blog.post.update NO-OP — rejected");
            throw new PostError(400, "key cannot be changed");
          }
          return reply.status(action === "create" ? 201 : 200).send(await savePost(app.prisma, site, request.body, request.log, action === "create" ? "create" : "update"));
        } catch (error) {
          // Mutation services log outcomes before rethrowing.
          if (error instanceof RouteCollisionError) return sendRouteCollision(reply, error);
          if (error instanceof PostError || error instanceof LayoutKindError) return reply.status(error.statusCode).send({ error: error.message });
          throw error;
        }
      },
    });
  }

  for (const [resource, kind] of [["categories", "category"], ["tags", "tag"]] as const) {
    app.get<{ Params: { siteKey: string } }>(`/:siteKey/blog/${resource}`, async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      return reply.send(await listBlogMasterdata(app.prisma, site.id, kind));
    });

    for (const [method, action] of [["POST", "create"], ["PATCH", "update"], ["DELETE", "delete"]] as const) {
      app.route<{ Params: { siteKey: string; key?: string }; Body: unknown }>({
        method,
        url: `/:siteKey/blog/${resource}${action === "create" ? "" : "/:key"}`,
        handler: async (request, reply) => {
          const site = await requireSite(app, request.params.siteKey);
          try {
            const result = await mutateBlogMasterdata(app.prisma, site.id, kind, action, request.params.key, request.body, request.log);
            return reply.status(action === "create" ? 201 : 200).send(result);
          } catch (error) {
            // The service logs the mutation outcome before rethrowing.
            if (error instanceof RouteCollisionError) return sendRouteCollision(reply, error);
            if (error instanceof MasterdataError || error instanceof LayoutKindError) return reply.status(error.statusCode).send({ error: error.message });
            throw error;
          }
        },
      });
    }
  }
}
