import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { Parser } from "htmlparser2";
import { config } from "../../config.js";
import { log } from "../../logging.js";

export class PostMediaError extends Error {
  constructor(public readonly statusCode: 400 | 404 | 415, message: string) {
    super(message);
    this.name = "PostMediaError";
  }
}

export function detectImageType(buf: Buffer): "png" | "jpeg" | "webp" | "gif" | null {
  if (buf.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (buf.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "jpeg";
  if (buf.length >= 12 && buf.toString("utf8", 0, 4) === "RIFF" && buf.toString("utf8", 8, 12) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(buf.toString("utf8", 0, 6))) return "gif";
  return null;
}

export function postMediaDiskPath(siteKey: string, mediaUrl: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(siteKey) || !mediaUrl.startsWith("/media/")) return null;
  const segments = mediaUrl.slice("/media/".length).split("/");
  if (segments.length < 2 || segments.some((segment) => !/^[a-z0-9.-]+$/.test(segment) || segment === "." || segment === "..")) return null;
  const siteDir = path.resolve(config.POST_MEDIA_DIR, siteKey);
  const diskPath = path.resolve(siteDir, ...segments);
  return diskPath.startsWith(siteDir + path.sep) ? diskPath : null;
}

export async function storePostMedia(siteKey: string, postKey: string, fileName: string, buf: Buffer, logger: FastifyBaseLogger = log): Promise<string> {
  const context = { op: "blog.media.store", siteKey, postKey, bytes: buf.length };
  logger.info(context, "blog.media.store requested");
  try {
    const type = detectImageType(buf);
    if (!type) throw new PostMediaError(415, "Unsupported image type; use PNG, JPEG, WebP or GIF");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(postKey)) throw new PostMediaError(400, "Invalid post key");
    const baseName = path.posix.basename(fileName.replaceAll("\\", "/"));
    const stem = path.parse(baseName).name.toLowerCase().replace(/[^a-z0-9.-]/g, "-") || "image";
    const hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
    const url = `/media/${postKey}/${hash}-${stem}.${type}`;
    const diskPath = postMediaDiskPath(siteKey, url);
    if (!diskPath) throw new PostMediaError(400, "Invalid post media path");
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    try {
      await fs.writeFile(diskPath, buf, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      logger.info(context, "blog.media.store NO-OP — content address already exists");
      return url;
    }
    logger.info(context, "blog.media.store stored");
    return url;
  } catch (error) {
    if (error instanceof PostMediaError) {
      logger.warn({ ...context, err: error }, "blog.media.store rejected");
      logger.info(context, "blog.media.store NO-OP — rejected");
    } else {
      logger.error({ ...context, err: error }, "blog.media.store failed");
      logger.info(context, "blog.media.store failed to complete");
    }
    throw error;
  }
}

export function referencedMediaUrls(html: string, coverImage: string | null): string[] {
  const urls = new Set<string>();
  const parser = new Parser({
    onopentag(name, attributes) {
      if (name === "img" && attributes.src?.startsWith("/media/")) urls.add(attributes.src);
    },
  });
  parser.end(html);
  if (coverImage?.startsWith("/media/")) urls.add(coverImage);
  return [...urls];
}
