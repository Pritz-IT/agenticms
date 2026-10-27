import type { FastifyInstance } from "fastify";
import { requireSite } from "../services/sites.js";
import { LayoutKindError } from "../services/blog/layout-kind.js";
import { RouteCollisionError } from "../services/blog/route-lock.js";
import { listBlogMasterdata, MasterdataError, mutateBlogMasterdata } from "../services/blog/masterdata.js";
import { sendRouteCollision } from "./route-collision.js";

export async function registerSiteBlogRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

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
