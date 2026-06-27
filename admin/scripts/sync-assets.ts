/**
 * Walk ASSETS_DIR and ensure every file has an Asset row. Use this to backfill
 * after dropping files in by hand or restoring a volume.
 *
 *   ASSETS_DIR=./.agenticms/assets DATABASE_URL=... npx tsx scripts/sync-assets.ts
 *
 * Or via the npm script:
 *
 *   npm run db:sync-assets
 *
 * - Existing rows (matched by filePath) are left alone.
 * - Unknown extensions are skipped (not deleted).
 * - Files map to `/assets/<relative-path>` URLs so the existing /assets/*
 *   static handler picks them up.
 */
import { readdir } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import { PrismaClient } from "@prisma/client";

const MIME_BY_EXT: Record<string, string> = {
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".gif":   "image/gif",
  ".webp":  "image/webp",
  ".svg":   "image/svg+xml",
  ".avif":  "image/avif",
  ".ico":   "image/x-icon",
  ".pdf":   "application/pdf",
  ".json":  "application/json",
  ".js":    "text/javascript",
  ".mjs":   "text/javascript",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".otf":   "font/otf",
  ".mp4":   "video/mp4",
  ".webm":  "video/webm",
};

const ASSETS_DIR = process.env.ASSETS_DIR ?? "./assets";
const UPLOADED_BY = process.env.SYNC_UPLOADED_BY ?? "system";

async function walk(dir: string, urlPrefix: string): Promise<Array<{ full: string; url: string }>> {
  const out: Array<{ full: string; url: string }> = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const url = `${urlPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...(await walk(full, url)));
    } else if (entry.isFile()) {
      out.push({ full, url });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const existing = new Set(
      (await prisma.asset.findMany({ select: { filePath: true } })).map((a) => a.filePath)
    );

    let files: Array<{ full: string; url: string }>;
    try {
      files = await walk(ASSETS_DIR, "/assets");
    } catch (err) {
      console.error(`[sync-assets] Could not read ASSETS_DIR=${ASSETS_DIR}:`, err);
      process.exit(1);
    }

    const created: string[] = [];
    const skippedExt: string[] = [];
    const alreadyRegistered: string[] = [];

    for (const { full, url } of files) {
      if (existing.has(url)) {
        alreadyRegistered.push(url);
        continue;
      }
      const ext = extname(full).toLowerCase();
      const mimeType = MIME_BY_EXT[ext];
      if (!mimeType) {
        skippedExt.push(`${url} (unknown ext ${ext || "<none>"})`);
        continue;
      }
      await prisma.asset.create({
        data: {
          filename: relative(ASSETS_DIR, full).replace(/^.*\//, ""),
          mimeType,
          filePath: url,
          uploadedBy: UPLOADED_BY,
        },
      });
      created.push(url);
    }

    console.log(`[sync-assets] ASSETS_DIR = ${ASSETS_DIR}`);
    console.log(`[sync-assets] Scanned ${files.length} files`);
    console.log(`[sync-assets] Created ${created.length} new asset rows:`);
    for (const url of created) console.log(`  +  ${url}`);
    if (alreadyRegistered.length) {
      console.log(`[sync-assets] Already registered: ${alreadyRegistered.length}`);
    }
    if (skippedExt.length) {
      console.log(`[sync-assets] Skipped (unsupported extension): ${skippedExt.length}`);
      for (const s of skippedExt) console.log(`  -  ${s}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
