import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcrypt";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { Site } from "@prisma/client";
import { config } from "../config.js";
import { requireSite, type SiteParams } from "../services/sites.js";

const BCRYPT_ROUNDS = 10;
const DEFAULT_SITE_KEY = "demo";
const HTPASSWD_USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

interface CreateStagingAccessBody {
  username: string;
  password: string;
  expiresAt?: string;
}

function isValidHtpasswdUsername(username: unknown): username is string {
  return typeof username === "string" && HTPASSWD_USERNAME_PATTERN.test(username);
}

function isSafeHtpasswdHash(hash: unknown): hash is string {
  return typeof hash === "string" && hash.length > 0 && !/[:\r\n]/.test(hash);
}

function isActiveStagingEntry(entry: { expiresAt: Date | string | null }, now = new Date()): boolean {
  if (!entry.expiresAt) return true;
  return new Date(entry.expiresAt).getTime() > now.getTime();
}

async function listStagingAccess(app: FastifyInstance, siteId: string, reply: FastifyReply) {
  const entries = await app.prisma.stagingAccess.findMany({ where: { siteId } });
  const sanitized = entries.map(({ passwordHash: _ph, ...rest }) => rest);
  return reply.send(sanitized);
}

async function rewriteStagingHtpasswd(app: FastifyInstance, site: Pick<Site, "id" | "key">) {
  const entries = await app.prisma.stagingAccess.findMany({
    where: { siteId: site.id },
    orderBy: { username: "asc" },
  });
  const siteBuildsDir = join(config.BUILDS_DIR, site.key);
  await mkdir(siteBuildsDir, { recursive: true });
  await writeFile(
    join(siteBuildsDir, ".htpasswd-staging"),
    entries
      .filter((entry) => isActiveStagingEntry(entry))
      .map((entry) => {
        if (!isValidHtpasswdUsername(entry.username)) {
          throw new Error(`Invalid staging access username: ${entry.username}`);
        }
        if (!isSafeHtpasswdHash(entry.passwordHash)) {
          throw new Error(`Invalid staging access password hash for ${entry.username}`);
        }
        return `${entry.username}:${entry.passwordHash}`;
      })
      .join("\n"),
    "utf-8",
  );
}

async function createStagingAccess(
  app: FastifyInstance,
  site: Pick<Site, "id" | "key">,
  body: CreateStagingAccessBody,
  reply: FastifyReply,
  request: FastifyRequest
) {
  const { username, password, expiresAt } = body ?? {};

  if (!isValidHtpasswdUsername(username)) {
    return reply.status(400).send({ error: "Invalid staging access username" });
  }

  if (!password) {
    return reply.status(400).send({ error: "username and password are required" });
  }

  request.log.info({ op: "stagingAccess.create", siteId: site.id, siteKey: site.key, hasExpiry: !!expiresAt }, "stagingAccess.create requested");

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const entry = await app.prisma.stagingAccess.create({
    data: {
      siteId: site.id,
      username,
      passwordHash,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
  });
  await rewriteStagingHtpasswd(app, site);

  request.log.info({ op: "stagingAccess.create", siteId: site.id, siteKey: site.key, entryId: entry.id, hasExpiry: !!expiresAt }, "stagingAccess.create done");
  const { passwordHash: _ph, ...sanitized } = entry;
  return reply.status(201).send(sanitized);
}

async function deleteStagingAccess(
  app: FastifyInstance,
  site: Pick<Site, "id" | "key">,
  id: string,
  reply: FastifyReply,
  request: FastifyRequest
) {
  request.log.info({ op: "stagingAccess.delete", siteId: site.id, siteKey: site.key, entryId: id }, "stagingAccess.delete requested");

  const existing = await app.prisma.stagingAccess.findFirst({ where: { id, siteId: site.id } });
  if (!existing) {
    request.log.info({ op: "stagingAccess.delete", siteId: site.id, siteKey: site.key, entryId: id }, "stagingAccess.delete NO-OP — nothing matched");
    return reply.status(404).send({ error: "Staging access entry not found" });
  }

  await app.prisma.stagingAccess.delete({ where: { id } });
  await rewriteStagingHtpasswd(app, site);
  request.log.info({ op: "stagingAccess.delete", siteId: site.id, siteKey: site.key, entryId: id }, "stagingAccess.delete done");
  return reply.send({ ok: true });
}

export async function registerSiteStagingAccessRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get<{ Params: SiteParams }>("/:siteKey/staging-access", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return listStagingAccess(app, site.id, reply);
  });

  app.post<{ Params: SiteParams; Body: CreateStagingAccessBody }>("/:siteKey/staging-access", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return createStagingAccess(app, site, request.body, reply, request);
  });

  app.delete<{ Params: SiteParams & { id: string } }>("/:siteKey/staging-access/:id", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    return deleteStagingAccess(app, site, request.params.id, reply, request);
  });
}

export default async function stagingAccessRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get("/", async (_request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return listStagingAccess(app, site.id, reply);
  });

  app.post<{ Body: CreateStagingAccessBody }>("/", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return createStagingAccess(app, site, request.body, reply, request);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const site = await requireSite(app, DEFAULT_SITE_KEY);
    return deleteStagingAccess(app, site, request.params.id, reply, request);
  });
}
