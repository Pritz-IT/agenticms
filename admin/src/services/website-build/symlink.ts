import { mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { config } from "../../config.js";
import { log } from "../../logging.js";

export async function ensureBuildsDir(siteKey?: string): Promise<void> {
  await mkdir(siteKey ? join(config.BUILDS_DIR, siteKey) : config.BUILDS_DIR, { recursive: true });
}

export function currentSymlinkPath(siteKey: string, target: string): string {
  return join(config.BUILDS_DIR, siteKey, `current-${target}`);
}

function isPathWithinRoot(candidate: string, root: string): boolean {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + sep);
}

function assertBuildDirMatchesSiteTarget(siteKey: string, target: string, buildDir: string): void {
  const siteBuildsDir = resolve(config.BUILDS_DIR, siteKey);
  const resolvedBuildDir = resolve(buildDir);
  if (!isPathWithinRoot(resolvedBuildDir, siteBuildsDir) || !basename(resolvedBuildDir).startsWith(`${target}-`)) {
    throw new Error(`Build directory is outside ${siteKey}/${target} builds: ${buildDir}`);
  }
}

export async function swapSymlink(siteKey: string, target: string, buildDir: string): Promise<void> {
  assertBuildDirMatchesSiteTarget(siteKey, target, buildDir);
  await ensureBuildsDir(siteKey);
  const linkPath = currentSymlinkPath(siteKey, target);

  try {
    await unlink(linkPath);
  } catch (err) {
    // Symlink doesn't exist yet — that's fine on first build.
    log.debug({ err, linkPath, target }, "symlink.swapSymlink — unlink skipped, symlink did not exist");
  }

  await symlink(resolve(buildDir), linkPath);
}

export async function getCurrentBuild(siteKey: string, target: string): Promise<string | null> {
  const linkPath = currentSymlinkPath(siteKey, target);
  try {
    return await readlink(linkPath);
  } catch (err) {
    log.debug({ err, linkPath, target }, "symlink.getCurrentBuild — symlink not found, no current build");
    return null;
  }
}
