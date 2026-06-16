import type { FastifyInstance } from "fastify";
import { copyGlobalTemplateToSite } from "../services/global-layout-templates.js";

interface CopyBody {
  destinationPath?: string;
}

function errorStatus(message: string): number {
  return message.includes("already exists") ? 409 : 400;
}

export async function globalLayoutTemplateRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (_request, reply) => {
    const templates = await app.prisma.globalLayoutTemplate.findMany({ orderBy: { key: "asc" } });
    return reply.send(templates);
  });
}

export async function siteGlobalLayoutTemplateRoutes(app: FastifyInstance) {
  app.post<{ Params: { siteKey: string; templateId: string }; Body: CopyBody }>(
    "/:siteKey/global-layout-templates/:templateId/copy",
    { preHandler: app.requireRole("admin") },
    async (request, reply) => {
      try {
        const layout = await copyGlobalTemplateToSite(app, request.params.siteKey, request.params.templateId, {
          destinationPath: request.body?.destinationPath,
        });
        return reply.status(201).send(layout);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(errorStatus(message)).send({ error: message });
      }
    }
  );
}
