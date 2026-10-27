import type { FastifyInstance } from "fastify";
import { requireSite } from "../services/sites.js";
import { LayoutKindError } from "../services/blog/layout-kind.js";
import { RouteCollisionError } from "../services/blog/route-lock.js";
import { listBlogMasterdata, MasterdataError, mutateBlogMasterdata } from "../services/blog/masterdata.js";
import { sendRouteCollision } from "./route-collision.js";
import { deletePost, getPost, listPosts, PostError, type PostInput, savePost, setPostTranslationStatus } from "../services/blog/posts.js";

export async function registerSiteBlogRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

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
