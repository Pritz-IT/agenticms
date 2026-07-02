import type { FastifyInstance } from "fastify";
import { requireSite, type SiteParams } from "../services/sites.js";
import { normalizeSlug, addAllowedForm, removeAllowedForm, listAllowedForms, formsOutcomeStatus } from "../services/site-forms.js";

export async function registerSiteFormsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get<{ Params: SiteParams }>("/:siteKey/forms", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return reply.send({ forms: await listAllowedForms(app, site.id) });
  });

  app.post<{ Params: SiteParams; Body: { form?: unknown } }>("/:siteKey/forms", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const slug = normalizeSlug(request.body?.form);
    if (!slug) return reply.status(400).send({ error: "Invalid form name" });
    const result = await addAllowedForm(app, site.id, slug);
    if (result.outcome === "limit") return reply.status(409).send({ error: "form limit reached" });
    return reply.status(formsOutcomeStatus(result.outcome)).send({ forms: result.forms });
  });

  app.delete<{ Params: SiteParams & { slug: string } }>("/:siteKey/forms/:slug", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const slug = normalizeSlug(request.params.slug);
    if (!slug) return reply.status(400).send({ error: "Invalid form name" });
    const result = await removeAllowedForm(app, site.id, slug);
    return reply.send({ forms: result.forms });
  });
}
