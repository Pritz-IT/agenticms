import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { createHash, timingSafeEqual } from "crypto";
import { config } from "../config.js";
import { findValidCliToken, type CliScope } from "../services/cli-auth.js";

// Constant-time secret comparison. Both sides are SHA-256'd first so the
// buffers are always equal length (timingSafeEqual throws on length
// mismatch) and the input length is not itself a side channel.
function secretsMatch(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string") return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

function isJwtPayload(payload: string | jwt.JwtPayload): payload is JwtPayload {
  return (
    typeof payload === "object" &&
    typeof payload.sub === "string" &&
    typeof payload.email === "string" &&
    typeof payload.role === "string"
  );
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    authenticateCli(requiredScope: CliScope): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole(role: "admin" | "editor"): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireInternalKey(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}

async function authPlugin(app: FastifyInstance) {
  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      request.log.debug({ reqId: request.id }, "auth rejected — missing/invalid Authorization header");
      return reply.status(401).send({ error: "Missing or invalid Authorization header" });
    }

    const token = authHeader.slice(7);

    let payload: JwtPayload;
    try {
      const verified = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ["HS256"],
      });
      if (!isJwtPayload(verified)) {
        request.log.debug({ reqId: request.id }, "auth rejected — malformed token payload");
        return reply.status(401).send({ error: "Invalid or expired token" });
      }
      payload = verified;
    } catch (err) {
      request.log.debug({ reqId: request.id, err }, "auth rejected — invalid/expired token");
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    const user = await app.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      request.log.debug({ reqId: request.id, userId: payload.sub }, "auth rejected — token user no longer exists");
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    request.user = {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  });

  app.decorate("requireRole", (role: "admin" | "editor") => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.authenticate(request, reply);

      // authenticate populates request.user on success and sends 401
      // otherwise. Gate on the user it set, not on reply.sent (which is
      // fragile across Fastify versions), so we never double-send.
      if (!request.user) return;

      const userRole = request.user.role;

      if (role === "admin" && userRole !== "admin") {
        request.log.warn(
          { reqId: request.id, userId: request.user?.id, requiredRole: "admin", actualRole: userRole },
          "authorization denied — insufficient role"
        );
        return reply.status(403).send({ error: "Admin role required" });
      }

      if (role === "editor" && userRole !== "editor" && userRole !== "admin") {
        request.log.warn(
          { reqId: request.id, userId: request.user?.id, requiredRole: "editor", actualRole: userRole },
          "authorization denied — insufficient role"
        );
        return reply.status(403).send({ error: "Editor role required" });
      }
    };
  });

  app.decorate("authenticateCli", (requiredScope: CliScope) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        request.log.debug({ reqId: request.id }, "cli auth rejected — missing/invalid Authorization header");
        return reply.status(401).send({ error: "Missing or invalid Authorization header" });
      }

      const token = authHeader.slice(7);
      const verified = await findValidCliToken(app.prisma, token);
      if (!verified) {
        request.log.debug({ reqId: request.id, requiredScope }, "cli auth rejected — invalid/expired token");
        return reply.status(401).send({ error: "Invalid or expired CLI token" });
      }

      if (verified.user.role !== "admin") {
        request.log.warn(
          { reqId: request.id, requiredScope, tokenId: verified.id, userId: verified.user.id, role: verified.user.role },
          "cli auth rejected — user no longer has admin role"
        );
        return reply.status(403).send({ error: "Admin role required" });
      }

      if (!verified.scopes.includes(requiredScope)) {
        request.log.warn({ reqId: request.id, requiredScope, tokenId: verified.id }, "cli auth rejected — missing scope");
        return reply.status(403).send({ error: "CLI token missing required scope" });
      }

      request.user = {
        id: verified.user.id,
        email: verified.user.email,
        role: verified.user.role,
      };
    };
  });

  app.decorate("requireInternalKey", async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers["x-api-key"];

    if (!secretsMatch(apiKey, config.INTERNAL_API_KEY)) {
      return reply.status(401).send({ error: "Invalid or missing API key" });
    }
  });
}

export default fp(authPlugin, { name: "auth" });
