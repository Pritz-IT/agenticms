import type { FastifyInstance } from "fastify";

export const MAX_ALLOWED_FORMS = 50;
export const MAX_SLUG_LEN = 64;
const SLUG_RE = /^[a-z0-9-]+$/;

export function normalizeSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim().toLowerCase();
  if (slug.length < 1 || slug.length > MAX_SLUG_LEN) return null;
  return SLUG_RE.test(slug) ? slug : null;
}

export async function listAllowedForms(app: FastifyInstance, siteId: string): Promise<string[]> {
  const site = await app.prisma.site.findUnique({ where: { id: siteId }, select: { allowedForms: true } });
  return site?.allowedForms ?? [];
}

export async function addAllowedForm(
  app: FastifyInstance, siteId: string, slug: string,
): Promise<{ forms: string[]; outcome: "added" | "noop" | "limit" }> {
  app.log.info({ op: "site-forms.add", siteId, slug }, "site-forms.add requested");
  // Atomic: append only if absent AND under the cap — both guards in one UPDATE.
  const affected = await app.prisma.$executeRaw`
    UPDATE "sites" SET "allowed_forms" = array_append("allowed_forms", ${slug})
    WHERE id = ${siteId}
      AND NOT (${slug} = ANY("allowed_forms"))
      AND cardinality("allowed_forms") < ${MAX_ALLOWED_FORMS}`;
  const forms = await listAllowedForms(app, siteId);
  if (affected > 0) { app.log.info({ op: "site-forms.add", siteId, slug }, "site-forms.add done — added"); return { forms, outcome: "added" }; }
  const outcome = forms.includes(slug) ? "noop" : "limit";
  app.log.info({ op: "site-forms.add", siteId, slug, outcome }, `site-forms.add ${outcome === "noop" ? "NO-OP — already present" : "rejected — limit reached"}`);
  return { forms, outcome };
}

export async function removeAllowedForm(
  app: FastifyInstance, siteId: string, slug: string,
): Promise<{ forms: string[]; outcome: "removed" | "noop" }> {
  app.log.info({ op: "site-forms.remove", siteId, slug }, "site-forms.remove requested");
  const affected = await app.prisma.$executeRaw`
    UPDATE "sites" SET "allowed_forms" = array_remove("allowed_forms", ${slug})
    WHERE id = ${siteId} AND ${slug} = ANY("allowed_forms")`;
  const forms = await listAllowedForms(app, siteId);
  const outcome = affected > 0 ? "removed" : "noop";
  app.log.info({ op: "site-forms.remove", siteId, slug, outcome }, `site-forms.remove done — ${outcome}`);
  return { forms, outcome };
}

export function formsOutcomeStatus(outcome: "added" | "removed" | "noop" | "limit"): number {
  return outcome === "limit" ? 409 : 200;
}
