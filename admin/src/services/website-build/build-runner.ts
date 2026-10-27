import { accessSync, existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { PrismaClient } from "@prisma/client";

import { config } from "../../config.js";
import { log } from "../../logging.js";
import { buildSiteConfig } from "./site-config.js";
import { swapSymlink } from "./symlink.js";
import { cleanupOldBuilds } from "./cleanup.js";
import type { BuildResult, SiteConfig } from "./types.js";
import { postMediaDiskPath, referencedMediaUrls } from "../blog/post-media.js";

const DEFAULT_SITE_KEY = "demo";
const HTPASSWD_USERNAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function isSafeHtpasswdHash(hash: unknown): hash is string {
  return typeof hash === "string" && hash.length > 0 && !/[:\r\n]/.test(hash);
}

function isActiveStagingEntry(entry: { expiresAt: Date | string | null }, now = new Date()): boolean {
  if (!entry.expiresAt) return true;
  return new Date(entry.expiresAt).getTime() > now.getTime();
}

function stripSitePrefix(filePath: string, siteKey: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const prefix = `${siteKey}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}

export function isValidBuildOutputPath(outputPath: string, siteKey: string, target: string): boolean {
  const siteBuildsDir = resolve(config.BUILDS_DIR, siteKey);
  const resolvedOutput = resolve(outputPath);
  return isPathWithinRoot(resolvedOutput, siteBuildsDir) && basename(resolvedOutput).startsWith(`${target}-`);
}

function validateConfig(siteConfig: SiteConfig, siteKey: string): void {
  const layoutIds = new Set(siteConfig.layouts.map((l) => l.id));

  for (const page of siteConfig.pages) {
    if (!page.layoutId) {
      log.warn({ path: page.path }, "build.validateConfig — page has no layout assigned");
      continue;
    }
    if (!layoutIds.has(page.layoutId)) {
      log.warn({ path: page.path, layoutId: page.layoutId }, "build.validateConfig — page references missing layout");
    }
  }

  for (const layout of siteConfig.layouts) {
    const layoutFile = join(config.LAYOUTS_DIR, siteKey, stripSitePrefix(layout.filePath, siteKey));
    try {
      accessSync(layoutFile);
    } catch (err) {
      const post = siteConfig.posts.find((post) => post.layoutFilePath === layout.filePath);
      if (post) throw new Error(`Post ${post.key}: layout file is missing: ${layout.filePath}`, { cause: err });
      log.warn({ err, layoutFile }, "build.validateConfig — layout file not found");
    }
  }
}

export async function copyPostMedia(
  siteKey: string,
  posts: SiteConfig["posts"],
  targetDir: string,
  target: SiteConfig["buildTarget"] = "production",
): Promise<number> {
  const context = { op: "blog.build.media", siteKey, target, posts: new Set(posts.map(({ key }) => key)).size };
  log.info(context, "blog.build.media requested");
  try {
    const files = new Map<string, string>();
    for (const post of posts) {
      for (const url of referencedMediaUrls(post.body, post.coverImage)) {
        const source = postMediaDiskPath(siteKey, url);
        if (!source) throw new Error(`Post ${post.key}: invalid media URL ${url}`);
        try {
          if (!(await stat(source)).isFile()) throw new Error("Not a file");
        } catch (err) {
          throw new Error(`Post ${post.key}: missing or unreadable media ${url}`, { cause: err });
        }
        files.set(source, join(targetDir, url.slice(1)));
      }
    }

    // Replace dist's media subtree so only this target's post media can be served.
    await rm(join(targetDir, "media"), { recursive: true, force: true });
    const copied = new Set<string>();
    for (const [source, destination] of files) {
      await mkdir(dirname(destination), { recursive: true });
      await cp(source, destination);
      copied.add(source);
    }
    if (target === "staging") {
      for (const key of new Set(posts.map(({ key }) => key))) {
        const mediaPath = postMediaDiskPath(siteKey, `/media/${key}/placeholder`);
        if (!mediaPath) throw new Error(`Post ${key}: invalid media directory`);
        const sourceDir = dirname(mediaPath);
        if (!existsSync(sourceDir)) continue;
        await cp(sourceDir, join(targetDir, "media", key), {
          recursive: true,
          filter: async (source) => {
            if ((await stat(source)).isFile()) copied.add(resolve(source));
            return true;
          },
        });
      }
    }
    log.info({ ...context, mediaFiles: copied.size }, copied.size ? "blog.build.media copied" : "blog.build.media NO-OP — no media to copy");
    return copied.size;
  } catch (err) {
    log.error({ ...context, err }, "blog.build.media failed");
    log.info(context, "blog.build.media failed to complete");
    throw err;
  }
}

function serializeStagingHtpasswd(siteConfig: SiteConfig): string {
  return siteConfig.stagingAccess
    .filter((entry) => isActiveStagingEntry(entry))
    .map((entry) => {
      if (!HTPASSWD_USERNAME_PATTERN.test(entry.username)) {
        throw new Error(`Invalid staging access username: ${entry.username}`);
      }
      if (!isSafeHtpasswdHash(entry.passwordHash)) {
        throw new Error(`Invalid staging access password hash for ${entry.username}`);
      }
      return `${entry.username}:${entry.passwordHash}`;
    })
    .join("\n");
}

async function writeSiteConfigJson(siteConfig: SiteConfig): Promise<void> {
  const dataDir = join(config.ASTRO_PROJECT_DIR, "src", "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "config.json"),
    JSON.stringify(siteConfig, null, 2),
    "utf-8"
  );
}

async function clearDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const entry of await readdir(dir)) {
    await rm(join(dir, entry), { recursive: true, force: true });
  }
}

async function syncAssets(siteKey: string): Promise<void> {
  const assetsRoot = join(config.ASTRO_PROJECT_DIR, "public", "assets");
  const destDir = join(assetsRoot, siteKey);
  const siteAssetsDir = join(config.ASSETS_DIR, siteKey);
  const sharedAssetsDir = join(config.ASSETS_DIR, "_global", "shared");
  const sharedDestDir = join(assetsRoot, "_global", "shared");
  await clearDirectory(assetsRoot);

  if (existsSync(sharedAssetsDir)) {
    await mkdir(sharedDestDir, { recursive: true });
    for (const entry of await readdir(sharedAssetsDir)) {
      await cp(join(sharedAssetsDir, entry), join(sharedDestDir, entry), {
        recursive: true,
      });
    }
  }

  await mkdir(destDir, { recursive: true });

  if (!existsSync(siteAssetsDir)) {
    log.warn({ assetsDir: siteAssetsDir, siteKey }, "build.syncAssets — ASSETS_DIR not found, skipping asset sync");
    return;
  }

  for (const entry of await readdir(siteAssetsDir)) {
    await cp(join(siteAssetsDir, entry), join(destDir, entry), {
      recursive: true,
    });
  }
}

async function syncLayouts(siteKey: string): Promise<void> {
  const destDir = join(config.ASTRO_PROJECT_DIR, "src", "layouts");
  const siteLayoutsDir = join(config.LAYOUTS_DIR, siteKey);
  await clearDirectory(destDir);

  try {
    for (const file of await readdir(siteLayoutsDir)) {
      await cp(join(siteLayoutsDir, file), join(destDir, file), {
        recursive: true,
      });
    }
  } catch (err) {
    log.warn({ err, layoutsDir: siteLayoutsDir, siteKey }, "build.syncLayouts — LAYOUTS_DIR not found or empty, skipping layout copy");
  }
}

function runAstroBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["astro", "build"], {
      cwd: config.ASTRO_PROJECT_DIR,
      stdio: "inherit",
      env: process.env,
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`astro build timed out after ${config.ASTRO_BUILD_TIMEOUT_MS}ms`));
    }, config.ASTRO_BUILD_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`astro build exited with code ${code}`));
    });
  });
}

export async function runBuild(
  prisma: PrismaClient,
  buildId: string,
  siteKeyOrTarget: string,
  maybeTarget?: string,
): Promise<BuildResult> {
  const siteKey = maybeTarget === undefined ? DEFAULT_SITE_KEY : siteKeyOrTarget;
  const target = maybeTarget ?? siteKeyOrTarget;
  return runBuildLocked(prisma, buildId, siteKey, target);
}

async function runBuildLocked(
  prisma: PrismaClient,
  buildId: string,
  siteKey: string,
  target: string,
): Promise<BuildResult> {
  log.info({ op: "blog.build", target, siteKey, buildId }, "blog.build requested");
  try {
    if (target !== "staging" && target !== "production") throw new Error(`Invalid build target: ${target}`);
    // 1. Resolve config from DB
    const siteConfig = await buildSiteConfig(prisma, siteKey, target);
    validateConfig(siteConfig, siteKey);
    const stagingHtpasswdContent = target === "staging"
      ? serializeStagingHtpasswd(siteConfig)
      : null;

    // 2. Stage inputs into the astro project tree
    await writeSiteConfigJson(siteConfig);
    await syncAssets(siteKey);
    await syncLayouts(siteKey);

    // 3. Build
    await runAstroBuild();

    // 4. Publish to versioned dir under BUILDS_DIR
    const timestamp = Date.now();
    const versionedDir = join(config.BUILDS_DIR, siteKey, `${target}-${timestamp}`);
    await mkdir(versionedDir, { recursive: true });
    await cp(join(config.ASTRO_PROJECT_DIR, "dist"), versionedDir, {
      recursive: true,
    });
    const mediaFiles = await copyPostMedia(siteKey, siteConfig.posts, versionedDir, target);

    // 5. Swap symlink and prune older versions
    await swapSymlink(siteKey, target, versionedDir);
    if (siteConfig.settings) {
      await cleanupOldBuilds(prisma, siteConfig.settings.id, siteKey, target);
    }

    // 6. Write .htpasswd for staging Basic Auth. Always rewrite staging so
    // revoked last credentials truncate stale nginx auth files.
    if (target === "staging") {
      await writeFile(
        join(config.BUILDS_DIR, siteKey, ".htpasswd-staging"),
        stagingHtpasswdContent ?? "",
        "utf-8"
      );
    }

    log.info({ op: "blog.build", target, posts: new Set(siteConfig.posts.map(({ key }) => key)).size, translations: siteConfig.posts.length, mediaFiles }, "blog.build completed");
    return { success: true, outputPath: versionedDir };
  } catch (err: unknown) {
    const errorLog = err instanceof Error ? err.message : String(err);
    log.error({ err, buildId, target }, "build.runBuild failed");
    log.info({ op: "blog.build", target, siteKey, buildId }, "blog.build failed to complete");
    return { success: false, errorLog };
  }
}

export async function rollback(
  _prisma: PrismaClient,
  _buildId: string,
  outputPath: string,
  siteKeyOrTarget: string,
  maybeTarget?: string,
): Promise<BuildResult> {
  const siteKey = maybeTarget === undefined ? DEFAULT_SITE_KEY : siteKeyOrTarget;
  const target = maybeTarget ?? siteKeyOrTarget;
  if (!isValidBuildOutputPath(outputPath, siteKey, target)) {
    return { success: false, errorLog: `Build directory is outside ${siteKey}/${target} builds: ${outputPath}` };
  }
  if (!existsSync(outputPath)) {
    return { success: false, errorLog: `Build directory not found: ${outputPath}` };
  }
  try {
    await swapSymlink(siteKey, target, outputPath);
    return { success: true, outputPath };
  } catch (err: unknown) {
    log.error({ err, target, outputPath }, "build.rollback failed");
    return {
      success: false,
      errorLog: err instanceof Error ? err.message : String(err),
    };
  }
}
