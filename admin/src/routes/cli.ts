import type { FastifyInstance, FastifyReply } from "fastify";
import {
  approveDeviceChallenge,
  consumeApprovedChallenge,
  createDeviceChallenge,
  revokeCliToken,
} from "../services/cli-auth.js";
import {
  exportLayoutFiles,
  syncAssetBatch,
  validateRelativePath,
  writeTextFileAtomic,
  type FileSyncResult,
  type LayoutSyncResult,
} from "../services/cli-sync.js";
import { admitBuild, BuildQueueAdmissionError, triggerBuild } from "../services/build.service.js";
import { requireSite, type SiteParams } from "../services/sites.js";
import { extname, join, resolve, sep } from "node:path";
import { readdir, rm } from "node:fs/promises";
import { config } from "../config.js";
import { handleFile } from "../services/layout-watcher.js";
import { createSite, type CreateSiteInput } from "../services/site-management.js";
import { syncGlobalLayoutBatch } from "../services/global-layout-templates.js";
import { GlobalAssetValidationError, syncGlobalAssetBatch } from "../services/global-assets.js";
import { cliInstallerScriptWithEtag, getCliArchive } from "../services/cli-installer.js";

const DEFAULT_SITE_KEY = "demo";
const TEXT_LAYOUT_EXTENSIONS = new Set([".tsx", ".ts"]);

interface DeviceBody {
  label?: string;
}

interface ApproveBody {
  code?: string;
}

interface TokenBody {
  deviceSecret?: string;
}

interface LayoutSyncBody {
  files?: Array<{ path: string; content: string }>;
}

interface AssetSyncBody {
  files?: Array<{ path: string; base64: string }>;
}

interface BuildBody {
  target?: "staging" | "production";
}

const cliDeviceRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "10 minutes",
  },
};

function cliBuildRateLimitKey(request: { headers: Record<string, unknown>; ip: string }): string {
  const auth = request.headers["authorization"];
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return /^[a-f0-9]{64}$/i.test(token)
    ? `cli-build-token:${token}`
    : `cli-build-ip:${request.ip}`;
}

const cliBuildRateLimit = {
  rateLimit: {
    max: 30,
    timeWindow: "1 minute",
    keyGenerator: cliBuildRateLimitKey,
  },
};

function bearerToken(header: unknown): string {
  return typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
}

function relativeFromRoot(root: string, filePath: string): string {
  return filePath.slice(resolve(root).length + 1).split(sep).join("/");
}

function pathWithinRoot(root: string, relPath: string): string {
  const rootAbs = resolve(root);
  const fullPath = resolve(rootAbs, relPath);
  if (fullPath !== rootAbs && !fullPath.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes target root: ${relPath}`);
  }
  return fullPath;
}

function hasMatchingEtag(ifNoneMatch: unknown, etag: string): boolean {
  if (typeof ifNoneMatch !== "string") return false;
  return ifNoneMatch.split(",").map((value) => value.trim()).includes(etag);
}

const INSTALLER_ORIGIN_HOST_BLOCKLIST = /[\s/\\?#;$`'"{}()]/;

function validateRawInstallerHost(rawHost: string): void {
  if (INSTALLER_ORIGIN_HOST_BLOCKLIST.test(rawHost)) {
    throw new Error("installer origin host contains invalid characters");
  }
}

function normalizeInstallerOrigin(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("installer origin must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("installer origin must not include credentials");
  }
  if (!url.hostname) {
    throw new Error("installer origin must include a hostname");
  }
  if (INSTALLER_ORIGIN_HOST_BLOCKLIST.test(url.host)) {
    throw new Error("installer origin host contains invalid characters");
  }
  return url.origin;
}

function installerOriginForRequest(request: { protocol: string; headers: { host?: unknown } }): string {
  const configuredOrigin = config.ADMIN_PUBLIC_URL.trim();
  if (configuredOrigin) {
    return normalizeInstallerOrigin(configuredOrigin);
  }

  const host = typeof request.headers.host === "string" && request.headers.host
    ? request.headers.host
    : `localhost:${config.PORT}`;
  validateRawInstallerHost(host);
  return normalizeInstallerOrigin(`${request.protocol}://${host}`);
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function listSiteLayoutFiles(root: string): Promise<string[]> {
  return (await walkFiles(root))
    .map((filePath) => relativeFromRoot(root, filePath))
    .filter((filePath) => extname(filePath).toLowerCase() === ".tsx")
    .filter((filePath) => !filePath.split("/").some((segment) => segment.startsWith(".")))
    .sort();
}

async function pruneStaleSiteLayoutFiles(root: string, keepPaths: Set<string>): Promise<void> {
  for (const filePath of await walkFiles(root)) {
    const relPath = relativeFromRoot(root, filePath);
    const ext = extname(relPath).toLowerCase();
    if (!TEXT_LAYOUT_EXTENSIONS.has(ext)) continue;
    if (relPath.split("/").some((segment) => segment.startsWith("."))) continue;
    if (keepPaths.has(relPath)) continue;
    await rm(filePath, { force: true });
  }
}

async function syncSiteLayoutBatch(
  app: FastifyInstance,
  site: { id: string; key: string },
  files: NonNullable<LayoutSyncBody["files"]>
): Promise<LayoutSyncResult> {
  const root = join(config.LAYOUTS_DIR, site.key);
  const results: FileSyncResult[] = [];
  const changedHelpers: string[] = [];
  const changedLayouts = new Set<string>();
  const syncedPaths = new Set<string>();

  for (const file of files) {
    const relPath = validateRelativePath(file.path, TEXT_LAYOUT_EXTENSIONS);
    syncedPaths.add(relPath);
    if (typeof file.content !== "string") throw new Error(`content must be a string for ${relPath}`);
    const fullPath = await writeTextFileAtomic(root, relPath, file.content);
    const ext = extname(relPath).toLowerCase();

    if (ext === ".tsx") {
      await handleFile(app.prisma, fullPath, app.layoutModuleCache, {
        storedFilePath: relPath,
        siteId: site.id,
        staleFilePaths: [`${site.key}/${relPath}`],
      });
      changedLayouts.add(relPath);
      results.push({ path: relPath, status: "compiled" });
    } else {
      changedHelpers.push(relPath);
      results.push({ path: relPath, status: "written" });
    }
  }

  if (changedLayouts.size > 0) {
    await pruneStaleSiteLayoutFiles(root, syncedPaths);
  }

  const recompiled: string[] = [];
  if (changedHelpers.length > 0) {
    for (const relPath of await listSiteLayoutFiles(root)) {
      if (changedLayouts.has(relPath)) continue;
      await handleFile(app.prisma, pathWithinRoot(root, relPath), app.layoutModuleCache, {
        storedFilePath: relPath,
        siteId: site.id,
        staleFilePaths: [`${site.key}/${relPath}`],
      });
      recompiled.push(relPath);
    }
  }

  return { files: results, recompiled };
}

async function sendCliStatus(app: FastifyInstance, siteKey: string, user: unknown, reply: FastifyReply) {
  const site = await requireSite(app, siteKey);
  const [layouts, assets, latestBuild] = await Promise.all([
    app.prisma.layout.count({ where: { siteId: site.id } }),
    app.prisma.asset.count({ where: { siteId: site.id } }),
    app.prisma.build.findFirst({ where: { siteId: site.id }, orderBy: { startedAt: "desc" } }),
  ]);

  return reply.send({
    ok: true,
    site,
    user,
    layouts,
    assets,
    latestBuild: latestBuild
      ? {
          id: latestBuild.id,
          target: latestBuild.target,
          status: latestBuild.status,
        }
      : null,
  });
}

async function createCliBuild(app: FastifyInstance, siteKey: string, target: BuildBody["target"], reply: FastifyReply) {
  if (!target || !["staging", "production"].includes(target)) {
    return reply.status(400).send({ error: "target must be 'staging' or 'production'" });
  }

  const site = await requireSite(app, siteKey);
  let admitted;
  try {
    admitted = await admitBuild(app.prisma, site.id, target);
  } catch (err) {
    if (err instanceof BuildQueueAdmissionError) {
      return reply.status(429).send({ error: err.message });
    }
    throw err;
  }

  const { build } = admitted;
  if (admitted.coalesced) {
    app.log.info({ op: "cli.build.trigger", buildId: build.id, siteKey: site.key, target, coalesced: true }, "cli build trigger coalesced");
    return reply.send({ ...build, coalesced: true });
  }
  app.log.info({ op: "cli.build.trigger", buildId: build.id, siteKey: site.key, target, coalesced: false }, "cli build trigger admitted");

  triggerBuild(app.prisma, build.id, site.key, target).catch(async (err: unknown) => {
    app.log.error({ op: "cli.build.trigger", err, buildId: build.id, siteKey: site.key, target }, "cli build trigger failed");
    await app.prisma.build.update({
      where: { id: build.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorLog: err instanceof Error ? err.message : String(err),
      },
    });
  });

  return reply.status(201).send(build);
}

export default async function cliRoutes(app: FastifyInstance) {
  app.get("/install.sh", async (request, reply) => {
    let origin;
    try {
      origin = installerOriginForRequest(request);
    } catch (err) {
      return reply.status(400).send({
        error: err instanceof Error ? err.message : "invalid installer origin",
      });
    }

    const { script, etag } = cliInstallerScriptWithEtag(origin);
    reply.header("Content-Type", "text/x-shellscript; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=300");
    reply.header("ETag", etag);
    if (hasMatchingEtag(request.headers["if-none-match"], etag)) {
      return reply.status(304).send();
    }
    return reply.send(script);
  });

  app.get("/agenticms-cli.tar.gz", async (request, reply) => {
    try {
      const archive = await getCliArchive();
      reply.header("Content-Type", "application/gzip");
      reply.header("Content-Disposition", 'attachment; filename="agenticms-cli.tar.gz"');
      reply.header("Cache-Control", "public, max-age=3600, must-revalidate");
      reply.header("ETag", archive.etag);
      if (hasMatchingEtag(request.headers["if-none-match"], archive.etag)) {
        return reply.status(304).send();
      }
      return reply.send(archive.buffer);
    } catch (err) {
      app.log.error({ err }, "failed to build cli archive");
      return reply.status(500).send({ error: "CLI archive is not available" });
    }
  });

  app.post<{ Body: DeviceBody }>("/device", { config: cliDeviceRateLimit }, async (request, reply) => {
    const challenge = await createDeviceChallenge(app.prisma, request.body?.label);
    return reply.status(201).send({
      deviceId: challenge.deviceId,
      deviceSecret: challenge.deviceSecret,
      code: challenge.code,
      expiresAt: challenge.expiresAt,
      approveUrl: `/cli/approve/${challenge.deviceId}`,
    });
  });

  app.post<{ Params: { id: string }; Body: ApproveBody }>(
    "/device/:id/approve",
    { preHandler: app.requireRole("admin") },
    async (request, reply) => {
      if (!request.body?.code) {
        return reply.status(400).send({ error: "code is required" });
      }

      const ok = await approveDeviceChallenge(app.prisma, request.params.id, request.body.code, request.user!);
      if (!ok) {
        return reply.status(400).send({ error: "Invalid, expired, or already used CLI approval code" });
      }

      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { id: string }; Body: TokenBody }>(
    "/device/:id/token",
    { config: cliDeviceRateLimit },
    async (request, reply) => {
      if (!request.body?.deviceSecret) {
        return reply.status(400).send({ error: "deviceSecret is required" });
      }

      const issued = await consumeApprovedChallenge(app.prisma, request.params.id, request.body.deviceSecret);
      if (!issued) {
        return reply.status(202).send({ status: "pending" });
      }

      return reply.send({
        token: issued.token,
        expiresAt: issued.expiresAt,
        scopes: issued.scopes,
      });
    }
  );

  app.delete("/token", { preHandler: app.authenticateCli("status:read") }, async (request, reply) => {
    await revokeCliToken(app.prisma, bearerToken(request.headers["authorization"]));
    return reply.send({ ok: true });
  });

  app.get("/status", { preHandler: app.authenticateCli("status:read") }, async (request, reply) => {
    return sendCliStatus(app, DEFAULT_SITE_KEY, request.user, reply);
  });

  app.post<{ Body: CreateSiteInput }>("/sites", { preHandler: app.authenticateCli("sites:write") }, async (request, reply) => {
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

  app.get("/export/layouts", { preHandler: app.authenticateCli("layouts:write") }, async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    const files = await exportLayoutFiles(join(config.LAYOUTS_DIR, site.key));
    return reply.send({ files });
  });

  app.post<{ Body: LayoutSyncBody }>(
    "/sync/layouts",
    { preHandler: app.authenticateCli("layouts:write") },
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files)) {
        return reply.status(400).send({ error: "files must be an array" });
      }

      try {
        const site = await requireSite(app, DEFAULT_SITE_KEY);
        const result = await syncSiteLayoutBatch(app, site, files);
        return reply.send(result);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post<{ Body: LayoutSyncBody }>(
    "/sync/global-layouts",
    { preHandler: app.authenticateCli("layouts:write") },
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files)) {
        return reply.status(400).send({ error: "files must be an array" });
      }

      try {
        const result = await syncGlobalLayoutBatch(app, files);
        return reply.send(result);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post<{ Body: AssetSyncBody }>(
    "/sync/global-assets",
    { preHandler: app.authenticateCli("assets:write"), bodyLimit: 40 * 1024 * 1024 },
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files)) {
        return reply.status(400).send({ error: "files must be an array" });
      }

      try {
        const result = await syncGlobalAssetBatch(app, files);
        return reply.send(result);
      } catch (err) {
        if (err instanceof GlobalAssetValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  app.post<{ Body: AssetSyncBody }>(
    "/sync/assets",
    { preHandler: app.authenticateCli("assets:write"), bodyLimit: 40 * 1024 * 1024 },
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files)) {
        return reply.status(400).send({ error: "files must be an array" });
      }

      try {
        const result = await syncAssetBatch(app, files);
        return reply.send(result);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post<{ Body: BuildBody }>(
    "/builds",
    { preHandler: app.authenticateCli("builds:write"), config: cliBuildRateLimit },
    async (request, reply) => {
      return createCliBuild(app, DEFAULT_SITE_KEY, request.body?.target, reply);
    }
  );

  app.get<{ Params: { id: string } }>(
    "/builds/:id",
    { preHandler: app.authenticateCli("builds:write") },
    async (request, reply) => {
      const site = await requireSite(app, DEFAULT_SITE_KEY);
      const build = await app.prisma.build.findFirst({ where: { id: request.params.id, siteId: site.id } });
      if (!build) return reply.status(404).send({ error: "Build not found" });
      return reply.send(build);
    }
  );
}

export async function registerSiteCliRoutes(app: FastifyInstance) {
  app.get<{ Params: SiteParams }>("/:siteKey/cli/status", { preHandler: app.authenticateCli("status:read") }, async (request, reply) => {
    return sendCliStatus(app, request.params.siteKey, request.user, reply);
  });

  app.get<{ Params: SiteParams }>("/:siteKey/cli/export/layouts", { preHandler: app.authenticateCli("layouts:write") }, async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const files = await exportLayoutFiles(join(config.LAYOUTS_DIR, site.key));
    return reply.send({ files });
  });

  app.post<{ Params: SiteParams; Body: LayoutSyncBody }>(
    "/:siteKey/cli/sync/layouts",
    { preHandler: app.authenticateCli("layouts:write") },
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files)) {
        return reply.status(400).send({ error: "files must be an array" });
      }

      try {
        const site = await requireSite(app, request.params.siteKey);
        const result = await syncSiteLayoutBatch(app, site, files);
        return reply.send(result);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post<{ Params: SiteParams; Body: AssetSyncBody }>(
    "/:siteKey/cli/sync/assets",
    { preHandler: app.authenticateCli("assets:write"), bodyLimit: 40 * 1024 * 1024 },
    async (request, reply) => {
      const files = request.body?.files;
      if (!Array.isArray(files)) {
        return reply.status(400).send({ error: "files must be an array" });
      }

      try {
        const site = await requireSite(app, request.params.siteKey);
        const result = await syncAssetBatch(app, site, files);
        return reply.send(result);
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  );

  app.post<{ Params: SiteParams; Body: BuildBody }>(
    "/:siteKey/cli/builds",
    { preHandler: app.authenticateCli("builds:write"), config: cliBuildRateLimit },
    async (request, reply) => createCliBuild(app, request.params.siteKey, request.body?.target, reply)
  );

  app.get<{ Params: SiteParams & { id: string } }>(
    "/:siteKey/cli/builds/:id",
    { preHandler: app.authenticateCli("builds:write") },
    async (request, reply) => {
      const site = await requireSite(app, request.params.siteKey);
      const build = await app.prisma.build.findFirst({ where: { id: request.params.id, siteId: site.id } });
      if (!build) return reply.status(404).send({ error: "Build not found" });
      return reply.send(build);
    }
  );
}
