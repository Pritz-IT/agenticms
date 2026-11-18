import type { FastifyReply, FastifyRequest } from "fastify";
import { promises as fs } from "node:fs";
import { detectImageType, postMediaDiskPath } from "../services/blog/post-media.js";

/** Streams one stored post image. Shared by the admin media route and the preview media route. */
export async function sendPostMedia(request: FastifyRequest, reply: FastifyReply, siteKey: string, mediaUrl: string) {
  const diskPath = postMediaDiskPath(siteKey, mediaUrl);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
  reply.header("Cache-Control", "private, no-store");
  if (!diskPath) return reply.status(404).send({ error: "Post media not found" });
  try {
    const buffer = await fs.readFile(diskPath);
    const type = detectImageType(buffer);
    if (!type) {
      request.log.warn({ op: "blog.media.read", siteKey }, "blog.media.read rejected — unsupported stored image");
      return reply.status(404).send({ error: "Post media not found" });
    }
    return reply.type(`image/${type}`).send(buffer);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      request.log.warn({ op: "blog.media.read", siteKey, err: error }, "blog.media.read missing");
      return reply.status(404).send({ error: "Post media not found" });
    }
    request.log.error({ op: "blog.media.read", siteKey, err: error }, "blog.media.read failed");
    throw error;
  }
}

