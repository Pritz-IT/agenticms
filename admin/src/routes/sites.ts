import type { FastifyInstance } from "fastify";
import { createSite, generateNginxHostMap, generateSiteKeys, type CreateSiteInput } from "../services/site-management.js";

export default async function sitesRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: app.authenticate }, async (_request, reply) => {
    const sites = await app.prisma.site.findMany({
      orderBy: { name: "asc" },
    });
    return reply.send(sites);
  });

  app.post<{ Body: CreateSiteInput }>("/", { preHandler: app.requireRole("admin") }, async (request, reply) => {
    try {
      const site = await createSite(app.prisma, request.body ?? {});
      return reply.status(201).send(site);
    } catch (err) {
      if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
        return reply.status(409).send({ error: "Site key, domain, or locale already exists" });
      }
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/nginx-map", { preHandler: app.requireInternalKey }, async (_request, reply) => {
    return reply.type("text/plain; charset=utf-8").send(await generateNginxHostMap(app.prisma));
  });

  app.get("/keys.txt", { preHandler: app.requireInternalKey }, async (_request, reply) => {
    return reply.type("text/plain; charset=utf-8").send(await generateSiteKeys(app.prisma));
  });
}
