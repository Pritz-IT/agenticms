import type { FastifyInstance } from "fastify";
import type { Site } from "@prisma/client";

export interface SiteParams {
  siteKey: string;
}

export async function findSiteByKey(app: FastifyInstance, siteKey: string): Promise<Site | null> {
  return app.prisma.site.findUnique({ where: { key: siteKey } });
}

export async function requireSite(app: FastifyInstance, siteKey: string): Promise<Site> {
  const site = await findSiteByKey(app, siteKey);
  if (!site) {
    const err = new Error(`Unknown site: ${siteKey}`);
    (err as Error & { statusCode?: number }).statusCode = 404;
    throw err;
  }
  return site;
}
