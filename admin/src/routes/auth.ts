import type { FastifyInstance, FastifyReply } from "fastify";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { randomUUID, createHash } from "crypto";
import { config } from "../config.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// A fixed valid bcrypt hash that no real password matches. When the supplied
// email has no account we still run one bcrypt.compare against this so the
// "unknown user" and "wrong password" paths take the same time — closing the
// account-enumeration timing oracle.
const DUMMY_PASSWORD_HASH =
  "$2b$10$g1roYT7VtyP3bo2JslwB8eKC4FwPHP7/Ay3Yu17Ht/z9YlpsAipvO";

function generateAccessToken(user: { id: string; email: string; role: string }): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

const REFRESH_TOKEN_COOKIE = "refreshToken";
const COOKIE_PATH = "/api/auth";
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Single source of truth for the refresh-cookie attributes so login and
// rotation cannot drift apart (httpOnly + SameSite=strict + Secure in prod,
// scoped to the auth path only).
function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    path: COOKIE_PATH,
    sameSite: "strict",
    secure: process.env["NODE_ENV"] === "production",
  });
}

// Mint a refresh token, persist only its SHA-256 hash, return the raw value.
async function issueRefreshToken(
  app: FastifyInstance,
  userId: string
): Promise<string> {
  const token = randomUUID();
  await app.prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  return token;
}

export default async function authRoutes(app: FastifyInstance) {
  // Per-IP brute-force limiter shared by the credential/token endpoints.
  const authRateLimit = {
    rateLimit: {
      max: config.LOGIN_RATE_MAX,
      timeWindow: config.LOGIN_RATE_WINDOW,
    },
  };

  // POST /login
  app.post<{ Body: { email: string; password: string } }>(
    "/login",
    { config: authRateLimit },
    async (request, reply) => {
    const { email, password } = request.body ?? {};

    request.log.info({ op: "auth.login" }, "auth.login requested");

    if (!email || !password) {
      return reply.status(400).send({ error: "email and password are required" });
    }

    const user = await app.prisma.user.findUnique({ where: { email } });

    // Always run a bcrypt comparison (against a dummy hash when the user does
    // not exist) so timing does not reveal whether the account exists.
    const passwordValid = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH
    );
    if (!user || !passwordValid) {
      return reply.status(401).send({ error: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await issueRefreshToken(app, user.id);
    setRefreshCookie(reply, refreshToken);

    request.log.info({ op: "auth.login", userId: user.id, role: user.role }, "auth.login done");

    return reply.send({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  });

  // POST /refresh — rotating refresh tokens with reuse detection.
  app.post("/refresh", { config: authRateLimit }, async (request, reply) => {
    request.log.info({ op: "auth.refresh" }, "auth.refresh requested");

    const presented = request.cookies[REFRESH_TOKEN_COOKIE];

    if (!presented) {
      return reply.status(401).send({ error: "No refresh token" });
    }

    const tokenHash = sha256(presented);
    const invalid = () => {
      reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: COOKIE_PATH });
      return reply.status(401).send({ error: "Invalid, expired, or revoked refresh token" });
    };

    const stored = await app.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.expiresAt <= new Date()) {
      return invalid();
    }

    if (stored.revoked) {
      // A previously rotated/revoked token is being replayed — treat as a
      // stolen-token compromise and revoke the user's entire token family so
      // both the attacker and the legitimate client are forced to re-login.
      await app.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revoked: false },
        data: { revoked: true },
      });
      request.log.warn({ op: "auth.refresh", userId: stored.userId }, "auth.refresh REUSE detected — family revoked");
      return invalid();
    }

    // Valid, unused token: rotate it (revoke old, issue new) atomically.
    const newRefreshToken = randomUUID();
    await app.prisma.$transaction([
      app.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revoked: true },
      }),
      app.prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: sha256(newRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        },
      }),
    ]);
    setRefreshCookie(reply, newRefreshToken);

    const accessToken = generateAccessToken(stored.user);

    request.log.info({ op: "auth.refresh", userId: stored.userId }, "auth.refresh done — rotated");

    return reply.send({
      accessToken,
      user: {
        id: stored.user.id,
        email: stored.user.email,
        role: stored.user.role,
      },
    });
  });

  // POST /logout
  app.post("/logout", async (request, reply) => {
    request.log.info({ op: "auth.logout", hadCookie: Boolean(request.cookies[REFRESH_TOKEN_COOKIE]) }, "auth.logout requested");

    const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE];

    if (refreshToken) {
      const tokenHash = sha256(refreshToken);

      await app.prisma.refreshToken.updateMany({
        where: { tokenHash },
        data: { revoked: true },
      });
    }

    reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: COOKIE_PATH });

    request.log.info({ op: "auth.logout" }, "auth.logout done");

    return reply.send({ ok: true });
  });
}
