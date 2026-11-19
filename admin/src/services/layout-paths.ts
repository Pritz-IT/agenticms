import { realpath, stat } from "fs/promises";
import { isAbsolute, resolve, sep } from "path";

// Moved from routes/layouts.ts so the blog post preview resolves layout files
// exactly like the visual editor module route does.
export const DEFAULT_SITE_KEY = "demo";
const LEGACY_LAYOUT_PREFIX = "/layouts/";

function isWithinLayoutsRoot(fullPath: string, root: string): boolean {
  return fullPath === root || fullPath.startsWith(root + sep);
}

export function stripSitePrefix(filePath: string, siteKey: string): string {
  const normalized = normalizeLayoutFilePath(filePath);
  const prefix = `${siteKey}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

export function normalizeLayoutFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith(LEGACY_LAYOUT_PREFIX)
    ? normalized.slice(LEGACY_LAYOUT_PREFIX.length)
    : normalized;
}

export async function resolveLayoutPath(filePath: string, root: string): Promise<string | null> {
  const candidates = isAbsolute(filePath)
    ? [resolve(filePath)]
    : [resolve(filePath), resolve(root, filePath)];
  const layoutsRootReal = await realpath(root).catch(() => root);

  for (const fullPath of candidates) {
    if (!isWithinLayoutsRoot(fullPath, root)) continue;
    const candidateReal = await realpath(fullPath).catch(() => null);
    if (!candidateReal) return fullPath;
    if (isWithinLayoutsRoot(candidateReal, layoutsRootReal)) return candidateReal;
  }

  return null;
}

export async function resolveSiteLayoutModulePath(filePath: string, siteKey: string, layoutsRoot: string): Promise<{
  filePathForResolution: string;
  root: string;
}> {
  const stripped = stripSitePrefix(filePath, siteKey);
  const siteRoot = resolve(layoutsRoot, siteKey);
  const siteScopedPath = await resolveLayoutPath(stripped, siteRoot);
  if (siteScopedPath && await stat(siteScopedPath).then(() => true).catch(() => false)) {
    return { filePathForResolution: stripped, root: siteRoot };
  }

  if (siteKey !== DEFAULT_SITE_KEY) {
    return { filePathForResolution: stripped, root: siteRoot };
  }

  return { filePathForResolution: normalizeLayoutFilePath(filePath), root: layoutsRoot };
}


/** Absolute path of a site layout file, or null when it resolves outside the layouts root. */
export async function resolveSiteLayoutFile(filePath: string, siteKey: string, layoutsRoot: string): Promise<string | null> {
  const resolved = await resolveSiteLayoutModulePath(filePath, siteKey, layoutsRoot);
  return resolveLayoutPath(resolved.filePathForResolution, resolved.root);
}
