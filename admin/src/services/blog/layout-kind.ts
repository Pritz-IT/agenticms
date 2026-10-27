import type { Layout, LayoutKind, Prisma } from "@prisma/client";

const LEGACY_LAYOUT_PREFIX = "/layouts/";

function legacyLayoutFilePath(filePath: string): string | null {
  if (filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath)) return null;
  return `${LEGACY_LAYOUT_PREFIX}${filePath}`;
}

export function legacyLayoutFilePaths(filePath: string, extraCandidates: string[] = []): string[] {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return [...new Set(extraCandidates)];

  const candidates: string[] = [...extraCandidates];
  const basename = normalized.split("/").at(-1);
  if (basename && basename !== normalized) {
    candidates.push(basename, `${LEGACY_LAYOUT_PREFIX}${basename}`);
  }

  const directLegacy = legacyLayoutFilePath(normalized);
  if (directLegacy) candidates.push(directLegacy);

  return [...new Set(candidates)].filter((candidate) => candidate !== normalized);
}

export function isAbsoluteStoredLayoutPath(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);
}

export class LayoutInUseError extends Error {
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "LayoutInUseError";
  }
}

export class LayoutKindError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "LayoutKindError";
  }
}

export async function assertLayoutChangesAllowed(
  prisma: Prisma.TransactionClient,
  siteId: string,
  changes: { filePath: string; nextKind: "page" | "post" | null }[]
): Promise<void> {
  if (changes.length === 0) return;
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { key: true } });
  const layouts = await prisma.layout.findMany({
    where: { siteId },
    include: {
      blogCategories: { where: { siteId }, select: { key: true }, orderBy: { key: "asc" } },
      blogPosts: { where: { siteId }, select: { key: true }, orderBy: { key: "asc" } },
      pages: { where: { siteId }, select: { path: true }, orderBy: { path: "asc" } },
    },
    orderBy: { filePath: "asc" },
  });
  const conflicts: string[] = [];
  for (const layout of layouts) {
    const owners = new Set<string>();
    for (const change of changes.filter((change) => {
      const filePath = change.filePath.replace(/\\/g, "/").replace(/^\/layouts\//, "");
      const aliases = [filePath, ...legacyLayoutFilePaths(filePath, site ? [`${site.key}/${filePath}`] : [])];
      return aliases.includes(layout.filePath)
        || (isAbsoluteStoredLayoutPath(layout.filePath) && layout.filePath.endsWith(`/${filePath.split("/").at(-1)}`));
    })) {
      if (change.nextKind !== "post") {
        layout.blogCategories.forEach(({ key }) => owners.add(`category ${key}`));
        layout.blogPosts.forEach(({ key }) => owners.add(`post ${key}`));
      }
      if (change.nextKind === "post") {
        layout.pages.forEach(({ path }) => owners.add(`page ${path}`));
      }
    }
    if (owners.size > 0) conflicts.push(`${layout.filePath}: ${[...owners].join(", ")}`);
  }
  if (conflicts.length > 0) throw new LayoutInUseError(`Layouts in use: ${conflicts.join("; ")}`);
}

export async function requireLayoutOfKind(
  prisma: Prisma.TransactionClient,
  siteId: string,
  layoutId: string,
  kind: LayoutKind
): Promise<Layout> {
  if (typeof layoutId !== "string" || !layoutId) throw new LayoutKindError("Layout is required");
  const layout = await prisma.layout.findFirst({ where: { id: layoutId, siteId } });
  if (!layout) throw new LayoutKindError("Layout not found for this site");
  if (layout.kind !== kind) throw new LayoutKindError(`Layout ${layout.filePath} must be kind ${kind}`);
  return layout;
}
