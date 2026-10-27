import type { FastifyReply } from "fastify";
import type { RouteCollisionError } from "../services/blog/route-lock.js";

export function sendRouteCollision(reply: FastifyReply, error: RouteCollisionError) {
  return reply.status(409).send({ error: error.message, conflicts: error.conflicts });
}
