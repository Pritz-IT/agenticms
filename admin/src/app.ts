import "./types.js";
import fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyServerOptions, type FastifyError } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "url";
import { join, dirname, resolve, sep } from "path";
import { existsSync, mkdirSync, createReadStream } from "fs";
import { stat } from "fs/promises";
import { config } from "./config.js";
import { loggerOptions } from "./logging.js";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import { LayoutModuleCache } from "./services/layout-module-cache.js";
import { MIME_BY_EXT } from "./services/asset-watcher.js";

import authRoutes from "./routes/auth.js";
import settingsRoutes, { registerSiteSettingsRoutes } from "./routes/settings.js";
import localesRoutes, { registerSiteLocalesRoutes } from "./routes/locales.js";
import layoutsRoutes, { registerSiteLayoutsRoutes } from "./routes/layouts.js";
import pagesRoutes, { registerSitePagesRoutes } from "./routes/pages.js";
import contentRoutes, { registerSiteContentRoutes } from "./routes/content.js";
import navigationRoutes, { registerSiteNavigationRoutes } from "./routes/navigation.js";
import assetsRoutes, { registerSiteAssetsRoutes } from "./routes/assets.js";
import stagingAccessRoutes, { registerSiteStagingAccessRoutes } from "./routes/staging-access.js";
import buildsRoutes, { registerSiteBuildsRoutes } from "./routes/builds.js";
import usersRoutes from "./routes/users.js";
import configRoutes from "./routes/config.js";
import submissionsRoutes, { registerSiteSubmissionsRoutes } from "./routes/submissions.js";
import cliRoutes, { registerSiteCliRoutes } from "./routes/cli.js";
import sitesRoutes from "./routes/sites.js";
import globalAssetsRoutes, { registerSiteGlobalAssetsRoutes } from "./routes/global-assets.js";
import {
  globalLayoutTemplateRoutes,
  siteGlobalLayoutTemplateRoutes,
} from "./routes/global-layout-templates.js";

const ATTACHMENT_ASSET_EXTENSIONS = new Set([".svg", ".html", ".htm", ".xhtml", ".xml"]);

// Fastify's trustProxy: boolean | string (comma-sep IPs/subnets) | number.
// A literal "true"/"false" string would otherwise be treated as a hostname,
// so coerce those to booleans; any other non-empty value is an IP/subnet list.
function resolveTrustProxy(raw: string): boolean | string {
  const v = raw.trim();
  if (v === "" || v.toLowerCase() === "false") return false;
  if (v.toLowerCase() === "true") return true;
  return v; // trimmed; e.g. "172.16.0.0/12" or the nginx container IP
}

type BuildAppOptions = Omit<FastifyServerOptions, "logger"> & {
  logger?: FastifyServerOptions["logger"] | FastifyBaseLogger;
};

function isLoggerInstance(logger: unknown): logger is FastifyBaseLogger {
  return Boolean(
    logger
      && typeof logger === "object"
      && typeof (logger as FastifyBaseLogger).child === "function"
      && typeof (logger as FastifyBaseLogger).info === "function",
  );
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const trustProxy = opts.trustProxy ?? resolveTrustProxy(config.TRUST_PROXY);
  const { logger: requestedLogger, ...fastifyOptions } = opts;
  const logger = requestedLogger ?? loggerOptions;
  const loggerConfig = isLoggerInstance(logger)
    ? { loggerInstance: logger }
    : { logger };
  const app = fastify({
    ...fastifyOptions,
    ...loggerConfig,
    genReqId: opts.genReqId ?? loggerOptions.genReqId,
    trustProxy,
  });

  app.decorate("layoutModuleCache", new LayoutModuleCache(config.COMPILED_LAYOUTS_DIR));

  // Echo the correlation id on every response (success and error) so the
  // browser can log/show it; the JSON body is never changed.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });

  // Every unhandled route error is logged with context (pino already stamps
  // the reqId), then the prior body/status is returned unchanged.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    const status = err.statusCode ?? 500;
    // 5xx = server exception (ERROR); 4xx = recoverable client anomaly (WARN).
    if (status >= 500) request.log.error({ err }, "request failed");
    else request.log.warn({ err }, "request failed");
    reply.status(status).send(err);
  });

  // Strict CORS: only the explicitly configured site origin(s) may make
  // credentialed cross-origin requests. Never reflect an arbitrary Origin.
  // (The public site reaches /api via a same-origin nginx proxy, so the
  // default — no cross-origin allowed — is correct for production.)
  const allowedOrigins = config.WEBSITE_ORIGIN.split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  await app.register(cookie);

  // Generous global floor for every route. Sensitive public/expensive routes
  // keep tighter route-level policies.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
  });

  await app.register(prismaPlugin);
  await app.register(authPlugin);

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(settingsRoutes, { prefix: "/api/settings" });
  await app.register(localesRoutes, { prefix: "/api/locales" });
  await app.register(layoutsRoutes, { prefix: "/api/layouts" });
  await app.register(pagesRoutes, { prefix: "/api/pages" });
  await app.register(contentRoutes, { prefix: "/api/content" });
  await app.register(navigationRoutes, { prefix: "/api/navigation" });
  await app.register(assetsRoutes, { prefix: "/api/assets" });
  await app.register(stagingAccessRoutes, { prefix: "/api/staging-access" });
  await app.register(buildsRoutes, { prefix: "/api/builds" });
  await app.register(usersRoutes, { prefix: "/api/users" });
  await app.register(configRoutes, { prefix: "/api/config" });
  await app.register(submissionsRoutes, { prefix: "/api/submissions" });
  await app.register(cliRoutes, { prefix: "/api/cli" });
  await app.register(globalAssetsRoutes, { prefix: "/api/global-assets" });
  await app.register(globalLayoutTemplateRoutes, { prefix: "/api/global-layout-templates" });
  await app.register(sitesRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteGlobalAssetsRoutes, { prefix: "/api/sites" });
  await app.register(siteGlobalLayoutTemplateRoutes, { prefix: "/api/sites" });
  await app.register(registerSitePagesRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteLayoutsRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteLocalesRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteContentRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteSettingsRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteNavigationRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteStagingAccessRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteAssetsRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteBuildsRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteCliRoutes, { prefix: "/api/sites" });
  await app.register(registerSiteSubmissionsRoutes, { prefix: "/api/sites" });

  // Serve uploaded assets at /assets/:filename
  const assetsDir = resolve(config.ASSETS_DIR);
  mkdirSync(assetsDir, { recursive: true });
  // Content types share the canonical MIME_BY_EXT table (asset-watcher.ts) so
  // the live /assets/* handler, the CLI sync gate, and the watcher never drift.
  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const filePath = request.params["*"];
    const fullPath = join(assetsDir, filePath);
    const ext = fullPath.substring(fullPath.lastIndexOf(".")).toLowerCase();
    reply.header("X-Content-Type-Options", "nosniff");
    if (ATTACHMENT_ASSET_EXTENSIONS.has(ext)) {
      reply.header("Content-Disposition", "attachment");
    }
    // Must be assetsDir itself or strictly within it. A bare startsWith would
    // also accept sibling dirs sharing the name as a prefix (e.g. /x/assets-2).
    if (fullPath !== assetsDir && !fullPath.startsWith(assetsDir + sep)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    try {
      await stat(fullPath);
    } catch (err) {
      request.log.debug({ reqId: request.id, filePath, err }, "asset not found");
      return reply.status(404).send({ error: "Not found" });
    }
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
    reply.header("Content-Type", contentType);
    return reply.send(createReadStream(fullPath));
  });

  // Serve built React SPA
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const publicDir = join(__dirname, "public");

  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      prefix: "/",
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        reply.status(404).send({ error: "Not Found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  return app;
}
