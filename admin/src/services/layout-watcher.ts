import { readFile } from "fs/promises";
import { performance } from "perf_hooks";
import { relative } from "path";
import chokidar, { type FSWatcher } from "chokidar";
import type { PrismaClient, Site } from "@prisma/client";
import { parseLayoutKeys, extractLayoutName, type LayoutKeys } from "./layout-parser.js";
import { compileLayout } from "./layout-compiler.js";
import type { LayoutModuleCache } from "./layout-module-cache.js";
import { log } from "../logging.js";

const CONTENT_TYPES = new Set(["text", "richtext", "image", "link", "page"]);
const LEGACY_LAYOUT_PREFIX = "/layouts/";
const DEFAULT_SITE_KEY = "demo";

interface LayoutWatcherSiteOptions {
  siteId?: string;
  siteKey?: string;
}

interface HandleFileOptions extends LayoutWatcherSiteOptions {
  storedFilePath?: string;
  staleFilePaths?: string[];
}

function canonicalLayoutFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.startsWith(LEGACY_LAYOUT_PREFIX)
    ? normalized.slice(LEGACY_LAYOUT_PREFIX.length)
    : normalized;
}

function legacyLayoutFilePath(filePath: string): string | null {
  if (filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath)) return null;
  return `${LEGACY_LAYOUT_PREFIX}${filePath}`;
}

function legacyLayoutFilePaths(filePath: string, extraCandidates: string[] = []): string[] {
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

function isAbsoluteStoredLayoutPath(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:\//.test(filePath);
}

async function upsertCanonicalLayout(
  prisma: PrismaClient,
  siteId: string,
  filePath: string,
  name: string,
  detectedKeys: LayoutKeys,
  extraLegacyFilePaths: string[] = []
) {
  const legacyFilePaths = legacyLayoutFilePaths(filePath, extraLegacyFilePaths);
  const basename = filePath.replace(/\\/g, "/").split("/").at(-1);
  const [canonicalLayout, explicitLegacyLayouts, basenameLegacyLayouts] = await Promise.all([
    prisma.layout.findUnique({ where: { siteId_filePath: { siteId, filePath } } }),
    legacyFilePaths.length > 0
      ? prisma.layout.findMany({ where: { siteId, filePath: { in: legacyFilePaths } } })
      : Promise.resolve([]),
    basename
      ? prisma.layout.findMany({ where: { siteId, filePath: { endsWith: `/${basename}` } } })
      : Promise.resolve([]),
  ]);
  const absoluteLegacyLayouts = basenameLegacyLayouts
    .filter((layout) => isAbsoluteStoredLayoutPath(layout.filePath))
    .filter((layout) => layout.filePath !== filePath);
  const legacyLayouts = [...explicitLegacyLayouts, ...absoluteLegacyLayouts]
    .filter((layout) => layout.id !== canonicalLayout?.id)
    .filter((layout, index, layouts) => layouts.findIndex((candidate) => candidate.id === layout.id) === index)
    .sort((a, b) => legacyFilePaths.indexOf(a.filePath) - legacyFilePaths.indexOf(b.filePath));

  if (canonicalLayout && legacyLayouts.length > 0) {
    const layout = await prisma.$transaction(async (tx) => {
      for (const staleLayout of legacyLayouts) {
        await tx.page.updateMany({
          where: { siteId, layoutId: staleLayout.id },
          data: { layoutId: canonicalLayout.id },
        });
      }
      const updated = await tx.layout.update({
        where: { id: canonicalLayout.id },
        data: { name, detectedKeys: detectedKeys as any },
      });
      for (const staleLayout of legacyLayouts) {
        await tx.layout.delete({ where: { id: staleLayout.id } });
      }
      return updated;
    });
    return { layout, mode: "merge" as const, evictedLayoutIds: legacyLayouts.map((layout) => layout.id) };
  }

  if (canonicalLayout) {
    const layout = await prisma.layout.update({
      where: { id: canonicalLayout.id },
      data: { name, detectedKeys: detectedKeys as any },
    });
    return { layout, mode: "update" as const, evictedLayoutIds: [] };
  }

  if (legacyLayouts.length > 0) {
    const [primaryLayout, ...staleLayouts] = legacyLayouts;
    const layout = await prisma.$transaction(async (tx) => {
      for (const staleLayout of staleLayouts) {
        await tx.page.updateMany({
          where: { siteId, layoutId: staleLayout.id },
          data: { layoutId: primaryLayout.id },
        });
      }
      const updated = await tx.layout.update({
        where: { id: primaryLayout.id },
        data: { name, filePath, detectedKeys: detectedKeys as any },
      });
      for (const staleLayout of staleLayouts) {
        await tx.layout.delete({ where: { id: staleLayout.id } });
      }
      return updated;
    });
    return { layout, mode: "migrate" as const, evictedLayoutIds: staleLayouts.map((layout) => layout.id) };
  }

  const layout = await prisma.layout.create({
    data: { siteId, name, filePath, detectedKeys: detectedKeys as any },
  });
  return { layout, mode: "create" as const, evictedLayoutIds: [] };
}

async function resolveLayoutSite(
  prisma: PrismaClient,
  storedFilePath: string,
  options: LayoutWatcherSiteOptions = {}
): Promise<Site | null> {
  if (options.siteId) {
    return prisma.site.findUnique({ where: { id: options.siteId } });
  }

  if (options.siteKey) {
    return prisma.site.findUnique({ where: { key: options.siteKey } });
  }

  const [firstSegment] = storedFilePath.replace(/\\/g, "/").split("/");
  if (firstSegment) {
    const pathSite = await prisma.site.findUnique({ where: { key: firstSegment } });
    if (pathSite) return pathSite;
  }

  return prisma.site.findUnique({ where: { key: DEFAULT_SITE_KEY } });
}

/**
 * Read a layout file, parse its keys, and upsert the Layout record in the DB.
 * Then pre-fill any missing content entries for all pages × keys × locales.
 */
export async function handleFile(
  prisma: PrismaClient,
  filePath: string,
  moduleCache?: LayoutModuleCache,
  options: HandleFileOptions = {}
): Promise<void> {
  const storedFilePath = canonicalLayoutFilePath(options.storedFilePath ?? filePath);
  const site = await resolveLayoutSite(prisma, storedFilePath, options);
  if (!site) {
    log.warn({ component: "layout-watcher", filePath, storedFilePath }, "layout NO-OP — site not found");
    return;
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    log.error({ component: "layout-watcher", filePath, err }, "layout read failed");
    return;
  }

  const detectedKeys = parseLayoutKeys(content);
  if (Object.keys(detectedKeys).length === 0) {
    log.info({ component: "layout-watcher", filePath }, "layout NO-OP — no keys found, skipped");
    return;
  }

  const name = extractLayoutName(filePath);

  log.info({ component: "layout-watcher", filePath, storedFilePath, siteId: site.id, siteKey: site.key, name }, "layout upsert requested");

  const { layout, mode, evictedLayoutIds } = await upsertCanonicalLayout(
    prisma,
    site.id,
    storedFilePath,
    name,
    detectedKeys,
    options.staleFilePaths
  );
  if (moduleCache) {
    for (const evictedLayoutId of evictedLayoutIds) {
      await moduleCache.evict(evictedLayoutId);
    }
  }

  log.info({ component: "layout-watcher", filePath, storedFilePath, siteId: site.id, siteKey: site.key, name, mode }, "layout upsert done");

  if (layout && moduleCache) {
    const started = performance.now();
    const compiled = await compileLayout(filePath);
    if (compiled.ok) {
      await moduleCache.set(layout.id, compiled.inputHash, compiled.code, compiled.inputs);
      log.info(
        {
          component: "layout-watcher",
          filePath,
          name,
          layoutId: layout.id,
          inputs: compiled.inputs.length,
          ms: Math.round(performance.now() - started),
        },
        "layout preview module compiled"
      );
    } else {
      log.error(
        {
          component: "layout-watcher",
          filePath,
          name,
          layoutId: layout.id,
          error: compiled.errors[0]?.text ?? "unknown compile error",
        },
        "layout preview module compile failed"
      );
    }
  }

  await prefillContent(prisma, storedFilePath, detectedKeys, { siteId: site.id });
}

/**
 * For each page using this layout × each detected key × each locale:
 * create a Content row with the initial value if one doesn't already exist.
 * Never overwrites existing content.
 */
export async function prefillContent(
  prisma: PrismaClient,
  layoutFilePath: string,
  detectedKeys: LayoutKeys,
  options: LayoutWatcherSiteOptions = {}
): Promise<void> {
  const site = await resolveLayoutSite(prisma, layoutFilePath, options);
  if (!site) return;

  const layout = await prisma.layout.findUnique({ where: { siteId_filePath: { siteId: site.id, filePath: layoutFilePath } } });
  if (!layout) return;

  const [pages, locales] = await Promise.all([
    prisma.page.findMany({ where: { siteId: site.id, layoutId: layout.id } }),
    prisma.locale.findMany({ where: { siteId: site.id } }),
  ]);

  if (pages.length === 0 || locales.length === 0) return;

  // Build all candidate rows, then batch-insert with skipDuplicates to avoid
  // N+1 queries (one findUnique + one create per page × key × locale combo).
  const contentKeys = Object.entries(detectedKeys).filter(([, keyDef]) =>
    CONTENT_TYPES.has(keyDef.type)
  );

  const rows = pages.flatMap((page) =>
    contentKeys.flatMap(([key, keyDef]) =>
      locales.map((locale) => ({
        pageId: page.id,
        key,
        locale: locale.code,
        value: keyDef.initial,
        type: keyDef.type as any,
      }))
    )
  );

  await prisma.content.createMany({ data: rows, skipDuplicates: true });
}

/**
 * Start a chokidar watcher on the given layouts directory.
 * Triggers handleFile on `add` and `change` events.
 */
export function startLayoutWatcher(
  prisma: PrismaClient,
  layoutsDir: string,
  moduleCache?: LayoutModuleCache
): FSWatcher {
  const fileQueues = new Map<string, Promise<void>>();
  const watcher = chokidar.watch(`${layoutsDir}/**/*.tsx`, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 500,
      pollInterval: 100,
    },
  });

  const storedPath = (filePath: string) => relative(layoutsDir, filePath).replace(/\\/g, "/");

  async function resolveWatchedFileOptions(filePath: string): Promise<HandleFileOptions> {
    const relativePath = storedPath(filePath);
    const [siteKey, ...rest] = relativePath.split("/");
    if (siteKey && rest.length > 0) {
      const site = await prisma.site.findUnique({ where: { key: siteKey } });
      if (site) {
        return {
          siteId: site.id,
          storedFilePath: rest.join("/"),
          staleFilePaths: [relativePath],
        };
      }
      return {
        siteKey,
        storedFilePath: rest.join("/"),
      };
    }
    return { storedFilePath: relativePath };
  }

  function enqueue(filePath: string, action: () => Promise<void>, errorMessage: string): void {
    const previous = fileQueues.get(filePath) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(action)
      .catch((err) => {
        log.error({ component: "layout-watcher", filePath, err }, errorMessage);
      })
      .finally(() => {
        if (fileQueues.get(filePath) === current) fileQueues.delete(filePath);
      });
    fileQueues.set(filePath, current);
  }

  watcher.on("add", (filePath) => {
    log.info({ component: "layout-watcher", filePath }, "layout file added");
    enqueue(filePath, async () => handleFile(prisma, filePath, moduleCache, await resolveWatchedFileOptions(filePath)), "layout add handling failed");
  });

  watcher.on("change", (filePath) => {
    log.info({ component: "layout-watcher", filePath }, "layout file changed");
    enqueue(filePath, async () => handleFile(prisma, filePath, moduleCache, await resolveWatchedFileOptions(filePath)), "layout change handling failed");
  });

  watcher.on("unlink", (filePath) => {
    log.info({ component: "layout-watcher", filePath }, "layout file removed");
    enqueue(filePath, async () => {
      const options = await resolveWatchedFileOptions(filePath);
      const storedFilePath = options.storedFilePath ?? storedPath(filePath);
      const site = await resolveLayoutSite(prisma, storedFilePath, options);
      if (!site) return;
      const layout = await prisma.layout.findUnique({
        where: { siteId_filePath: { siteId: site.id, filePath: storedFilePath } },
      });
      if (layout && moduleCache) {
        await moduleCache.evict(layout.id);
        log.info(
          { component: "layout-watcher", filePath, layoutId: layout.id },
          "layout preview module evicted"
        );
      }
    }, "layout unlink handling failed");
  });

  watcher.on("error", (err) => {
    log.error({ component: "layout-watcher", err }, "layout watcher error");
  });

  log.info({ component: "layout-watcher", layoutsDir }, "layout watcher started");
  return watcher;
}
