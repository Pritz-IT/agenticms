import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { config } from "../../config.js";
import { log } from "../../logging.js";
import { getCurrentBuild } from "./symlink.js";

// Removes versioned build dirs beyond `MAX_BUILDS` for the given target.
// Whenever a dir is removed, the matching Build row (if any) is flagged
// `filesDeleted = true` so the UI can disable rollback for it.
export async function cleanupOldBuilds(
  prisma: PrismaClient,
  siteId: string,
  siteKey: string,
  target: string,
): Promise<void> {
  const currentBuild = await getCurrentBuild(siteKey, target);
  const siteBuildsDir = join(config.BUILDS_DIR, siteKey);

  let entries: string[];
  try {
    const all = await readdir(siteBuildsDir);
    entries = all.filter((name) => name.startsWith(`${target}-`));
  } catch (err) {
    log.warn({ err, siteKey, target, buildsDir: siteBuildsDir }, "cleanup.cleanupOldBuilds — BUILDS_DIR not readable, skipping cleanup");
    return;
  }

  const withStats = await Promise.all(
    entries.map(async (name) => {
      const fullPath = join(siteBuildsDir, name);
      try {
        const s = await stat(fullPath);
        return { name, fullPath, mtime: s.mtime.getTime() };
      } catch (err) {
        log.warn({ err, fullPath }, "cleanup.cleanupOldBuilds — stat failed, treating mtime as 0");
        return { name, fullPath, mtime: 0 };
      }
    })
  );

  withStats.sort((a, b) => b.mtime - a.mtime);

  const toDelete = withStats.slice(config.MAX_BUILDS);
  for (const entry of toDelete) {
    if (currentBuild && entry.fullPath === currentBuild) {
      continue;
    }
    try {
      await rm(entry.fullPath, { recursive: true, force: true });
      await prisma.build.updateMany({
        where: { siteId, outputPath: entry.fullPath, filesDeleted: false },
        data: { filesDeleted: true },
      });
    } catch (err) {
      // Best-effort — leave the row untouched if we couldn't delete the files.
      log.warn({ err, outputPath: entry.fullPath, target }, "cleanup.cleanupOldBuilds — best-effort delete failed, row left untouched");
    }
  }
}
