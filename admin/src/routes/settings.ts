import type { FastifyInstance, FastifyReply } from "fastify";
import { requireSite, type SiteParams } from "../services/sites.js";

const DEFAULT_SITE_KEY = "demo";

interface SettingsBody {
  name?: string;
  domain?: string;
  stagingDomain?: string;
  defaultLocale?: string;
  siteUrl?: string;
}

async function updateSettingsForSite(app: FastifyInstance, siteKey: string, body: SettingsBody, reply: FastifyReply) {
  const site = await requireSite(app, siteKey);
  const { name, domain, stagingDomain, defaultLocale, siteUrl } = body ?? {};

  const updated = await app.prisma.site.update({
    where: { id: site.id },
    data: {
      ...(name !== undefined && { name }),
      ...(domain !== undefined && { domain }),
      ...(stagingDomain !== undefined && { stagingDomain }),
      ...(defaultLocale !== undefined && { defaultLocale }),
      ...(siteUrl !== undefined && { siteUrl }),
    },
  });
  return reply.send(updated);
}

export async function registerSiteSettingsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get<{ Params: SiteParams }>("/:siteKey/settings", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return reply.send(site);
  });

  app.put<{ Params: SiteParams; Body: SettingsBody }>("/:siteKey/settings", async (request, reply) =>
    updateSettingsForSite(app, request.params.siteKey, request.body, reply)
  );

  app.patch<{ Params: SiteParams; Body: SettingsBody }>("/:siteKey/settings", async (request, reply) =>
    updateSettingsForSite(app, request.params.siteKey, request.body, reply)
  );
}

export default async function settingsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  // Transitional legacy route — defaults to the demo site.
  app.get("/", async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return reply.send(site);
  });

  app.put<{ Body: SettingsBody }>("/", (request, reply) =>
    updateSettingsForSite(app, DEFAULT_SITE_KEY, request.body, reply)
  );
  app.patch<{ Body: SettingsBody }>("/", (request, reply) =>
    updateSettingsForSite(app, DEFAULT_SITE_KEY, request.body, reply)
  );
}
