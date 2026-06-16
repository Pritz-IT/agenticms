import type { FastifyInstance } from "fastify";
import type { GlobalLayoutTemplate, Layout } from "@prisma/client";
import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { config } from "../config.js";
import { compileLayout } from "./layout-compiler.js";
import { extractLayoutName, parseLayoutKeys } from "./layout-parser.js";
import { handleFile } from "./layout-watcher.js";
import { requireSite } from "./sites.js";
import { validateRelativePath, writeTextFileAtomic, type FileSyncResult } from "./cli-sync.js";
import { copyTemplateAssetsToSite, rewriteCopyableTemplateAssetUrls } from "./global-assets.js";

const TEXT_LAYOUT_EXTENSIONS = new Set([".tsx", ".ts"]);
const ROOT_LAYOUT_EXTENSIONS = new Set([".tsx"]);

export interface TextUploadFile {
  path: string;
  content: string;
}

export interface GlobalLayoutSyncResult {
  files: FileSyncResult[];
  templates: Array<{ key: string; status: "registered" }>;
}

export interface CopyGlobalTemplateOptions {
  destinationPath?: string;
}

interface HelperCopyPlan {
  sourceFile: string;
  targetRel: string;
}

function globalRoot(): string {
  return join(config.LAYOUTS_DIR, "_global");
}

function isTemplateRoot(relPath: string): boolean {
  return extname(relPath).toLowerCase() === ".tsx" && relPath.split("/").length === 2;
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function listTemplateRootFiles(templateFolder: string): Promise<string[]> {
  const folderAbs = join(globalRoot(), templateFolder);
  const entries = await readdir(folderAbs, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `${templateFolder}/${entry.name}`)
    .filter(isTemplateRoot)
    .sort();
}

async function hashCompiledInputs(absPath: string): Promise<string> {
  const compiled = await compileLayout(absPath);
  if (!compiled.ok) {
    throw new Error(compiled.errors[0]?.text ?? "Global template compile failed");
  }
  return compiled.inputHash;
}

async function upsertTemplate(app: FastifyInstance, relPath: string): Promise<GlobalLayoutTemplate> {
  const absPath = join(globalRoot(), relPath);
  const content = await readFile(absPath, "utf-8");
  const detectedKeys = parseLayoutKeys(content);
  if (Object.keys(detectedKeys).length === 0) {
    throw new Error(`Global template has no layout keys: ${relPath}`);
  }
  const sourceHash = await hashCompiledInputs(absPath);
  return app.prisma.globalLayoutTemplate.upsert({
    where: { key: relPath },
    update: {
      name: extractLayoutName(absPath),
      filePath: relPath,
      detectedKeys: detectedKeys as any,
      sourceHash,
    },
    create: {
      key: relPath,
      name: extractLayoutName(absPath),
      filePath: relPath,
      detectedKeys: detectedKeys as any,
      sourceHash,
    },
  });
}

function templateFolderFromPath(relPath: string): string {
  const parts = relPath.split("/");
  if (parts.length < 2) throw new Error(`global template path must include a template folder: ${relPath}`);
  return parts[0];
}

function destinationFolderFor(destinationPath: string): string {
  const folder = dirname(destinationPath).split(/[\\/]+/).join("/");
  return folder === "." ? "" : folder;
}

async function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export async function syncGlobalLayoutBatch(app: FastifyInstance, files: TextUploadFile[]): Promise<GlobalLayoutSyncResult> {
  const results: FileSyncResult[] = [];
  const changedRoots = new Set<string>();
  const changedFolders = new Set<string>();

  for (const file of files) {
    const relPath = validateRelativePath(file.path, TEXT_LAYOUT_EXTENSIONS);
    if (typeof file.content !== "string") throw new Error(`content must be a string for ${relPath}`);
    const templateFolder = templateFolderFromPath(relPath);
    await writeTextFileAtomic(globalRoot(), relPath, file.content);
    changedFolders.add(templateFolder);
    if (isTemplateRoot(relPath)) changedRoots.add(relPath);
    results.push({ path: relPath, status: isTemplateRoot(relPath) ? "registered" : "written" });
  }

  for (const folder of changedFolders) {
    for (const root of await listTemplateRootFiles(folder)) {
      changedRoots.add(root);
    }
  }

  const templates: GlobalLayoutSyncResult["templates"] = [];
  for (const relPath of [...changedRoots].sort()) {
    const template = await upsertTemplate(app, relPath);
    templates.push({ key: template.key, status: "registered" });
  }

  return { files: results, templates };
}

export async function copyGlobalTemplateToSite(
  app: FastifyInstance,
  siteKey: string,
  templateId: string,
  options: CopyGlobalTemplateOptions = {}
): Promise<Layout> {
  const [site, template] = await Promise.all([
    requireSite(app, siteKey),
    app.prisma.globalLayoutTemplate.findUnique({ where: { id: templateId } }),
  ]);
  if (!template) throw new Error("Global template not found");

  const destinationPath = validateRelativePath(options.destinationPath ?? template.key, ROOT_LAYOUT_EXTENSIONS);
  const existing = await app.prisma.layout.findUnique({
    where: { siteId_filePath: { siteId: site.id, filePath: destinationPath } },
  });
  if (existing && existing.globalTemplateId !== template.id) {
    throw new Error("Destination layout already exists");
  }

  const sourcePath = join(globalRoot(), template.filePath);
  const destinationAbs = join(config.LAYOUTS_DIR, site.key, destinationPath);
  if (!existing && await fileExists(destinationAbs)) {
    throw new Error("Destination layout already exists");
  }

  const templateFolder = templateFolderFromPath(template.filePath);
  const siteLayoutsRoot = join(config.LAYOUTS_DIR, site.key);
  const helperRoot = join(globalRoot(), templateFolder);
  const destinationFolder = destinationFolderFor(destinationPath);
  const helperPlans: HelperCopyPlan[] = [];
  for (const sourceFile of await walkFiles(helperRoot)) {
    const helperRel = relative(helperRoot, sourceFile).split(/[\\/]+/).join("/");
    if (isTemplateRoot(`${templateFolder}/${helperRel}`)) continue;
    if (!TEXT_LAYOUT_EXTENSIONS.has(extname(helperRel).toLowerCase())) continue;
    const targetRel = destinationFolder ? `${destinationFolder}/${helperRel}` : helperRel;
    if (!existing && await fileExists(join(siteLayoutsRoot, targetRel))) {
      throw new Error(`Destination helper already exists: ${targetRel}`);
    }
    helperPlans.push({ sourceFile, targetRel });
  }

  await mkdir(join(config.ASSETS_DIR, site.key), { recursive: true });
  await copyTemplateAssetsToSite(app, site, templateFolder);
  const rootContent = rewriteCopyableTemplateAssetUrls(
    await readFile(sourcePath, "utf-8"),
    site.key,
    templateFolder
  );
  await writeTextFileAtomic(siteLayoutsRoot, destinationPath, rootContent);

  for (const { sourceFile, targetRel } of helperPlans) {
    const helperContent = rewriteCopyableTemplateAssetUrls(
      await readFile(sourceFile, "utf-8"),
      site.key,
      templateFolder
    );
    await writeTextFileAtomic(siteLayoutsRoot, targetRel, helperContent);
  }

  await handleFile(app.prisma, destinationAbs, app.layoutModuleCache, {
    storedFilePath: destinationPath,
    siteId: site.id,
    staleFilePaths: [`${site.key}/${destinationPath}`],
  });

  return app.prisma.layout.update({
    where: { siteId_filePath: { siteId: site.id, filePath: destinationPath } },
    data: {
      globalTemplateId: template.id,
      globalTemplateHash: template.sourceHash,
    },
  });
}

export async function copyLinkedGlobalTemplateToLayout(
  app: FastifyInstance,
  siteKey: string,
  layoutId: string
): Promise<Layout> {
  const site = await requireSite(app, siteKey);
  const layout = await app.prisma.layout.findFirst({
    where: { id: layoutId, siteId: site.id },
  });
  if (!layout?.globalTemplateId) {
    throw new Error("Layout is not linked to a global template");
  }

  return copyGlobalTemplateToSite(app, site.key, layout.globalTemplateId, { destinationPath: layout.filePath });
}
