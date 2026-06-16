import type { FastifyInstance, FastifyReply } from "fastify";
import { admitBuild, BuildQueueAdmissionError, triggerBuild, triggerRollback } from "../services/build.service.js";
import { isValidBuildOutputPath } from "../services/website-build/build-runner.js";
import { requireSite, type SiteParams } from "../services/sites.js";

const DEFAULT_SITE_KEY = "demo";
function buildRateLimitKey(request: { headers: Record<string, unknown>; ip: string }): string {
  const auth = request.headers["authorization"];
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
    ? `build-token:${token}`
    : `build-ip:${request.ip}`;
}

const buildTriggerRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "1 minute",
    keyGenerator: buildRateLimitKey,
  },
};

interface CreateBuildBody {
  target: "staging" | "production";
}

interface UpdateBuildStatusBody {
  status: "building" | "success" | "failed";
  outputPath?: string;
  errorLog?: string;
}

async function rollbackBuildForSite(app: FastifyInstance, siteKey: string, id: string, reply: FastifyReply) {
  const site = await requireSite(app, siteKey);
  const build = await app.prisma.build.findFirst({ where: { id, siteId: site.id }, include: { site: true } });
  if (!build) {
    return reply.status(404).send({ error: "Build not found" });
  }

  if (build.status !== "success" || !build.outputPath) {
    return reply.status(400).send({ error: "Rollback is only available for successful builds with an outputPath" });
  }

  if (build.filesDeleted) {
    return reply.status(410).send({
      error: "Build files were pruned by retention and are no longer on disk",
    });
  }

  if (!isValidBuildOutputPath(build.outputPath, build.site.key, build.target)) {
    return reply.status(410).send({
      error: "Build files are outside the current site build directory and cannot be rolled back",
    });
  }

  triggerRollback(app.prisma, build.id, build.outputPath, build.site.key, build.target).catch(async (err: unknown) => {
    app.log.error({ op: "build.rollback", err, buildId: build.id }, "build.rollback failed");
  });

  return reply.send({ ok: true });
}

async function admitBuildForSite(app: FastifyInstance, siteKey: string, target: CreateBuildBody["target"]) {
  const site = await requireSite(app, siteKey);

  let admitted;
  try {
    admitted = await admitBuild(app.prisma, site.id, target);
  } catch (err) {
    if (err instanceof BuildQueueAdmissionError) {
      return { site, error: err.message };
    }
    throw err;
  }

  const { build } = admitted;
  if (!admitted.coalesced) {
    triggerBuild(app.prisma, build.id, site.key, target).catch(async (err: unknown) => {
      app.log.error({ op: "build.trigger", err, buildId: build.id, siteKey: site.key, target }, "build.trigger failed");
      await app.prisma.build.update({
        where: { id: build.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorLog: err instanceof Error ? err.message : String(err),
        },
      });
    });
  }

  return { site, build, coalesced: admitted.coalesced };
}

export default async function buildsRoutes(app: FastifyInstance) {
  // GET / — return all builds ordered by startedAt desc
  app.get("/", { preHandler: app.authenticate }, async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    const builds = await app.prisma.build.findMany({
      where: { siteId: site.id },
      orderBy: { startedAt: "desc" },
    });
    return reply.send(builds);
  });

  // POST / — create build record, fire-and-forget triggerBuild
  app.post<{ Body: CreateBuildBody }>("/", { preHandler: app.authenticate, config: buildTriggerRateLimit }, async (request, reply) => {
    const { target } = request.body ?? {};

    if (!target || !["staging", "production"].includes(target)) {
      return reply.status(400).send({ error: "target must be 'staging' or 'production'" });
    }

    const site = await requireSite(app, DEFAULT_SITE_KEY);

    request.log.info({ op: "build.trigger", siteKey: site.key, target }, "build.trigger requested");
    const admitted = await admitBuildForSite(app, site.key, target);
    if ("error" in admitted) {
      return reply.status(429).send({ error: admitted.error });
    }
    request.log.info(
      { op: "build.trigger", buildId: admitted.build.id, siteKey: admitted.site.key, target, coalesced: admitted.coalesced },
      "build.trigger done"
    );
    if (admitted.coalesced) return reply.send({ ...admitted.build, coalesced: true });
    return reply.status(201).send(admitted.build);
  });

  // POST /:id/status — internal callback from Website container
  app.post<{ Params: { id: string }; Body: UpdateBuildStatusBody }>(
    "/:id/status",
    { preHandler: app.requireInternalKey },
    async (request, reply) => {
      const { id } = request.params;
      const { status, outputPath, errorLog } = request.body ?? {};

      request.log.info({ op: "build.statusUpdate", buildId: id, status }, "build.statusUpdate requested");

      if (!["building", "success", "failed"].includes(status)) {
        return reply.status(400).send({ error: "Invalid build status" });
      }

      const site = await requireSite(app, DEFAULT_SITE_KEY);
      const existing = await app.prisma.build.findFirst({ where: { id, siteId: site.id } });
      if (!existing) {
        request.log.info({ op: "build.statusUpdate", buildId: id }, "build.statusUpdate NO-OP — nothing matched");
        return reply.status(404).send({ error: "Build not found" });
      }

      const isTerminal = status === "success" || status === "failed";
      if (outputPath !== undefined && !isValidBuildOutputPath(outputPath, site.key, existing.target)) {
        return reply.status(400).send({ error: "Invalid build output path" });
      }

      await app.prisma.build.updateMany({
        where: { id, siteId: site.id },
        data: {
          status,
          ...(outputPath !== undefined && { outputPath }),
          ...(errorLog !== undefined && { errorLog }),
          ...(isTerminal && { finishedAt: new Date() }),
        },
      });
      const build = await app.prisma.build.findFirstOrThrow({ where: { id, siteId: site.id } });

      request.log.info({ op: "build.statusUpdate", buildId: id, status, isTerminal }, "build.statusUpdate done");
      return reply.send(build);
    }
  );

  // POST /:id/rollback — rollback to a previous successful build
  app.post<{ Params: { id: string } }>(
    "/:id/rollback",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = request.params;

      request.log.info({ op: "build.rollback", buildId: id }, "build.rollback requested");
      const res = await rollbackBuildForSite(app, DEFAULT_SITE_KEY, id, reply);
      request.log.info({ op: "build.rollback", buildId: id }, "build.rollback done");
      return res;
    }
  );
}

export async function registerSiteBuildsRoutes(app: FastifyInstance) {
  app.get<{ Params: SiteParams }>("/:siteKey/builds", { preHandler: app.authenticate }, async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const builds = await app.prisma.build.findMany({
      where: { siteId: site.id },
      orderBy: { startedAt: "desc" },
    });
    return reply.send(builds);
  });

  app.post<{ Params: SiteParams; Body: CreateBuildBody }>(
    "/:siteKey/builds",
    { preHandler: app.authenticate, config: buildTriggerRateLimit },
    async (request, reply) => {
      const { target } = request.body ?? {};

      if (!target || !["staging", "production"].includes(target)) {
        return reply.status(400).send({ error: "target must be 'staging' or 'production'" });
      }

      const site = await requireSite(app, request.params.siteKey);

      request.log.info({ op: "build.trigger", siteKey: site.key, target }, "build.trigger requested");
      const admitted = await admitBuildForSite(app, site.key, target);
      if ("error" in admitted) {
        return reply.status(429).send({ error: admitted.error });
      }
      request.log.info(
        { op: "build.trigger", buildId: admitted.build.id, siteKey: admitted.site.key, target, coalesced: admitted.coalesced },
        "build.trigger done"
      );
      if (admitted.coalesced) return reply.send({ ...admitted.build, coalesced: true });
      return reply.status(201).send(admitted.build);
    }
  );

  app.post<{ Params: SiteParams & { id: string } }>(
    "/:siteKey/builds/:id/rollback",
    { preHandler: app.authenticate },
    async (request, reply) => {
      request.log.info({ op: "build.rollback", buildId: request.params.id, siteKey: request.params.siteKey }, "build.rollback requested");
      const res = await rollbackBuildForSite(app, request.params.siteKey, request.params.id, reply);
      request.log.info({ op: "build.rollback", buildId: request.params.id, siteKey: request.params.siteKey }, "build.rollback done");
      return res;
    }
  );
}
