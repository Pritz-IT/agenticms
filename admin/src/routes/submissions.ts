import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { config } from "../config.js";
import { checkDataCaps } from "../lib/submission-guards.js";
import { requireSite, type SiteParams } from "../services/sites.js";

interface CreateSubmissionBody {
  form: string;
  data: Record<string, unknown>;
  score?: number;
  email?: string;
  hp?: string;
  t?: number;
  ref?: string;
}

const ALLOWED_FORMS = ["sample-template", "solutions-consultation", "contact"] as const;
const DEFAULT_SITE_KEY = "demo";

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase() || null;
  } catch (_err) {
    return null;
  }
}

function configuredHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const fromUrl = hostFromUrl(value);
  return (fromUrl ?? value).toLowerCase();
}

function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const host = hostFromUrl(origin) ?? origin.toLowerCase();
  return Boolean(
    host === "localhost" ||
      host.startsWith("localhost:") ||
      host === "127.0.0.1" ||
      host.startsWith("127.0.0.1:") ||
      host === "[::1]" ||
      host.startsWith("[::1]:")
  );
}

async function resolveSubmissionSite(
  app: FastifyInstance,
  origin: string | undefined,
): Promise<{ id: string; key: string } | null> {
  if (isLocalhostOrigin(origin)) {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return { id: site.id, key: site.key };
  }
  if (!origin) {
    return null;
  }

  const host = hostFromUrl(origin) ?? configuredHost(origin);
  if (!host) {
    return null;
  }

  const sites = await app.prisma.site.findMany({
    select: { id: true, key: true, domain: true, stagingDomain: true, siteUrl: true },
  });
  for (const site of sites) {
    for (const value of [site.domain, site.stagingDomain, site.siteUrl]) {
      const allowed = configuredHost(value);
      if (allowed === host) {
        return { id: site.id, key: site.key };
      }
    }
  }
  return null;
}

async function listSubmissionsForSite(
  app: FastifyInstance,
  siteKey: string,
  form: string | undefined,
) {
  const site = await requireSite(app, siteKey);
  return app.prisma.submission.findMany({
    where: {
      siteId: site.id,
      ...(form ? { form } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

async function findSubmissionForSite(app: FastifyInstance, siteKey: string, id: string) {
  const site = await requireSite(app, siteKey);
  return app.prisma.submission.findFirst({
    where: { id, siteId: site.id },
  });
}

async function deleteSubmissionForSite(app: FastifyInstance, siteKey: string, id: string) {
  const site = await requireSite(app, siteKey);
  const submission = await app.prisma.submission.findFirst({
    where: { id, siteId: site.id },
    select: { id: true },
  });
  if (!submission) {
    return false;
  }
  await app.prisma.submission.delete({ where: { id: submission.id } });
  return true;
}

const createSubmissionSchema = {
  body: {
    type: "object",
    required: ["form", "data", "t"],
    additionalProperties: false,
    properties: {
      form: { type: "string", enum: ALLOWED_FORMS as unknown as string[] },
      data: { type: "object" },
      score: { type: "integer", minimum: 0, maximum: 36 },
      email: {
        type: "string",
        maxLength: 254,
        pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$",
      },
      hp: { type: "string", maxLength: 64 },
      t: { type: "integer", minimum: 0 },
      // Unguessable client-generated correlation id (crypto.randomUUID / hex).
      // Links the anonymous on-completion result to a later email submission.
      ref: { type: "string", pattern: "^[a-f0-9-]{8,64}$", maxLength: 64 },
    },
  },
};

function hostSignalFromHeaders(headers: Record<string, unknown>): string | undefined {
  const forwardedHost = headers["x-forwarded-host"];
  const host = headers.host;
  const raw = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : typeof forwardedHost === "string"
      ? forwardedHost
      : Array.isArray(host)
        ? host[0]
        : typeof host === "string"
          ? host
          : undefined;
  return raw?.split(",")[0]?.trim();
}

async function resolveSubmissionSiteFromSignals(
  app: FastifyInstance,
  origin: string | undefined,
  hostSignal: string | undefined,
): Promise<{ id: string; key: string } | null> {
  const primarySignal = origin ?? hostSignal;
  if (!primarySignal) {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return { id: site.id, key: site.key };
  }
  if (isLocalhostOrigin(primarySignal)) {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return { id: site.id, key: site.key };
  }
  return resolveSubmissionSite(app, primarySignal);
}

export default async function submissionsRoutes(app: FastifyInstance) {
  // POST / — public endpoint. Guarded: rate limit (per IP), JSON schema,
  // honeypot + min-fill time, origin allowlist, data size/shape caps.
  app.post<{ Body: CreateSubmissionBody }>(
    "/",
    {
      schema: createSubmissionSchema,
      attachValidation: true,
      bodyLimit: 8 * 1024,
      config: {
        rateLimit: {
          max: config.SUBMISSIONS_RATE_MAX,
          timeWindow: config.SUBMISSIONS_RATE_WINDOW,
        },
      },
    },
    async (request, reply) => {
      if (request.validationError) {
        return reply.status(400).send({ error: "Invalid submission" });
      }

      const { form, data, score, email, hp, t, ref } = request.body;

      // Honeypot: real users never fill this hidden field.
      if (hp && hp.trim() !== "") {
        return reply.status(400).send({ error: "Invalid submission" });
      }
      // Timing trap: t is elapsed ms since the form rendered (a duration).
      if (typeof t !== "number" || t < config.SUBMISSIONS_MIN_FILL_MS) {
        return reply.status(400).send({ error: "Invalid submission" });
      }

      const dataCheck = checkDataCaps(data, {
        maxBytes: config.SUBMISSIONS_DATA_MAX_BYTES,
        maxKeys: config.SUBMISSIONS_DATA_MAX_KEYS,
        maxStrLen: config.SUBMISSIONS_DATA_MAX_STRLEN,
        maxDepth: config.SUBMISSIONS_DATA_MAX_DEPTH,
      });
      if (!dataCheck.ok) {
        request.log.warn({ op: "submission.create", reason: dataCheck.reason }, "submission rejected — data caps");
        return reply.status(400).send({ error: "Invalid submission" });
      }

      const origin =
        (request.headers.origin as string | undefined) ??
        (request.headers.referer as string | undefined);
      const site = await resolveSubmissionSiteFromSignals(app, origin, hostSignalFromHeaders(request.headers));
      if (!site) {
        request.log.warn({ op: "submission.create", reason: "origin not allowed", origin, host: request.headers.host }, "submission rejected — origin");
        return reply.status(400).send({ error: "Invalid submission" });
      }

      // Attach-later: a recent anonymous result with this unguessable ref
      // gets the email + contact intent instead of creating a second row.
      // One-shot (only when its email is still null) and time-bounded, so a
      // stale/guessed ref can never overwrite an existing email or old data.
      if (ref) {
        const since = new Date(
          Date.now() - config.SUBMISSIONS_ATTACH_WINDOW_MS,
        );
        const existing = await app.prisma.submission.findFirst({
          where: { siteId: site.id, clientRef: ref, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
        });
        if (existing && existing.email == null && email) {
          request.log.info({ op: "submission.create", siteKey: site.key, form, attaching: true }, "submission.create requested — attach to prior result");
          const updated = await app.prisma.submission.update({
            where: { id: existing.id },
            data: {
              email,
              wantsContact: true,
              score: score ?? existing.score,
              data: data as Prisma.InputJsonValue,
            },
          });
          request.log.info({ op: "submission.create", siteKey: site.key, id: updated.id, form, attached: true }, "submission.create done — attached to prior result");
          return reply.status(201).send({ id: updated.id, attached: true });
        }
      }

      request.log.info({ op: "submission.create", siteKey: site.key, form, hasEmail: Boolean(email) }, "submission.create requested");
      const submission = await app.prisma.submission.create({
        data: {
          siteId: site.id,
          form,
          data: data as Prisma.InputJsonValue,
          score: score ?? null,
          email: email ?? null,
          clientRef: ref ?? null,
          wantsContact: !!email,
        },
      });

      request.log.info({ op: "submission.create", siteKey: site.key, id: submission.id, form }, "submission.create done");
      return reply.status(201).send({ id: submission.id, attached: false });
    }
  );

  // Everything below requires an authenticated admin. Submissions hold lead
  // PII (email + full quiz transcript) — editors must not read or delete them.
  app.register(async (authed) => {
    authed.addHook("onRequest", authed.requireRole("admin"));

    // GET / — list submissions, optionally filtered by form
    authed.get<{ Querystring: { form?: string } }>("/", async (request, reply) => {
      return reply.send(await listSubmissionsForSite(authed, DEFAULT_SITE_KEY, request.query.form));
    });

    // GET /:id
    authed.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const submission = await findSubmissionForSite(authed, DEFAULT_SITE_KEY, request.params.id);
      if (!submission) {
        return reply.status(404).send({ error: "Submission not found" });
      }

      return reply.send(submission);
    });

    // DELETE /:id
    authed.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const id = request.params.id;
      request.log.info({ op: "submission.delete", siteKey: DEFAULT_SITE_KEY, id }, "submission.delete requested");
      const deleted = await deleteSubmissionForSite(authed, DEFAULT_SITE_KEY, id);
      if (!deleted) {
        request.log.warn({ op: "submission.delete", siteKey: DEFAULT_SITE_KEY, id }, "submission.delete NO-OP — not found");
        return reply.status(404).send({ error: "Submission not found" });
      }

      request.log.info({ op: "submission.delete", siteKey: DEFAULT_SITE_KEY, id }, "submission.delete done");
      return reply.send({ ok: true });
    });
  });
}

export async function registerSiteSubmissionsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get<{ Params: SiteParams; Querystring: { form?: string } }>(
    "/:siteKey/submissions",
    async (request, reply) => {
      return reply.send(await listSubmissionsForSite(app, request.params.siteKey, request.query.form));
    },
  );

  app.get<{ Params: SiteParams & { id: string } }>("/:siteKey/submissions/:id", async (request, reply) => {
    const submission = await findSubmissionForSite(app, request.params.siteKey, request.params.id);
    if (!submission) {
      return reply.status(404).send({ error: "Submission not found" });
    }

    return reply.send(submission);
  });

  app.delete<{ Params: SiteParams & { id: string } }>("/:siteKey/submissions/:id", async (request, reply) => {
    const { siteKey, id } = request.params;
    request.log.info({ op: "submission.delete", siteKey, id }, "submission.delete requested");
    const deleted = await deleteSubmissionForSite(app, siteKey, id);
    if (!deleted) {
      request.log.warn({ op: "submission.delete", siteKey, id }, "submission.delete NO-OP — not found");
      return reply.status(404).send({ error: "Submission not found" });
    }

    request.log.info({ op: "submission.delete", siteKey, id }, "submission.delete done");
    return reply.send({ ok: true });
  });
}
