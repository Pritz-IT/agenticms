import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { discoverLayoutFiles } from "./discover.js";
import { loadCredential, resolveSiteSelection } from "./config.js";
import { requestJson } from "./http.js";

const LAYOUT_EXTENSIONS = new Set([".tsx", ".ts"]);

export interface RemoteLayoutFile {
  path: string;
  content: string;
  sha256: string;
}

export interface LayoutExportResponse {
  files: RemoteLayoutFile[];
}

export type LayoutDiffStatus = "same" | "changed" | "missing-local" | "local-only";
export type LayoutPullStatus = "same" | "updated" | "created";

export interface LayoutDiffEntry {
  path: string;
  status: LayoutDiffStatus;
}

export interface LayoutPullEntry {
  path: string;
  status: LayoutPullStatus;
}

export interface LayoutPullResult {
  files: LayoutPullEntry[];
  backupDir?: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(input: string): string {
  if (typeof input !== "string") throw new Error("path must be a string");
  const normalized = input.replace(/\\/g, "/").trim();
  if (!normalized) throw new Error("path is required");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`absolute paths are not allowed: ${input}`);
  }

  for (const segment of normalized.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`invalid path segment in ${input}`);
    }
    if (segment.startsWith(".")) {
      throw new Error(`hidden path segments are not allowed: ${input}`);
    }
  }

  const ext = extname(normalized).toLowerCase();
  if (!LAYOUT_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported file extension for ${input}`);
  }

  return normalized;
}

function pathWithinRoot(root: string, relPath: string): string {
  const rootAbs = resolve(root);
  const fullPath = resolve(rootAbs, relPath);
  if (fullPath !== rootAbs && !fullPath.startsWith(rootAbs + sep)) {
    throw new Error(`path escapes target root: ${relPath}`);
  }
  return fullPath;
}

function backupRoot(layoutsRoot: string, timestamp: string): string {
  const parent = dirname(layoutsRoot);
  if (basename(parent) === "layouts") {
    return join(dirname(parent), ".backups", "layouts", basename(layoutsRoot), timestamp);
  }
  return join(parent, ".backups", "layouts", timestamp);
}

function defaultTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "");
}

async function writeTextFileAtomic(root: string, relPath: string, content: string): Promise<void> {
  const fullPath = pathWithinRoot(root, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  const tmp = join(dirname(fullPath), `.${randomUUID()}.tmp`);
  await writeFile(tmp, content, "utf-8");
  await rename(tmp, fullPath);
}

async function localLayoutMap(layoutsRoot: string): Promise<Map<string, string>> {
  const files = await discoverLayoutFiles(layoutsRoot);
  return new Map(files.map((file) => [normalizeRelativePath(file.path), file.content]));
}

function remoteLayoutMap(files: RemoteLayoutFile[]): Map<string, RemoteLayoutFile> {
  return new Map(files.map((file) => [normalizeRelativePath(file.path), file]));
}

export async function fetchRemoteLayouts(adminUrlArg: string | undefined, siteKey: string): Promise<RemoteLayoutFile[]> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const result = await requestJson<LayoutExportResponse>(
    adminUrl,
    `/api/sites/${siteKey}/cli/export/layouts`,
    { method: "GET" },
    credential
  );
  return result.files.map((file) => ({
    path: normalizeRelativePath(file.path),
    content: file.content,
    sha256: file.sha256,
  }));
}

export async function compareLayoutFiles(
  layoutsRoot: string,
  remoteFiles: RemoteLayoutFile[]
): Promise<LayoutDiffEntry[]> {
  const local = await localLayoutMap(layoutsRoot);
  const remote = remoteLayoutMap(remoteFiles);
  const paths = [...new Set([...local.keys(), ...remote.keys()])].sort();

  return paths.map((path) => {
    const localContent = local.get(path);
    const remoteFile = remote.get(path);
    if (!remoteFile) return { path, status: "local-only" };
    if (localContent === undefined) return { path, status: "missing-local" };
    const remoteHash = remoteFile.sha256 || sha256(remoteFile.content);
    return {
      path,
      status: sha256(localContent) === remoteHash ? "same" : "changed",
    };
  });
}

export async function pullLayoutFiles(
  layoutsRoot: string,
  remoteFiles: RemoteLayoutFile[],
  options: { timestamp?: string } = {}
): Promise<LayoutPullResult> {
  const localRoot = layoutsRoot;
  const local = await localLayoutMap(layoutsRoot);
  const timestamp = options.timestamp ?? defaultTimestamp();
  const backupDir = backupRoot(layoutsRoot, timestamp);
  const result: LayoutPullEntry[] = [];
  let didBackup = false;

  for (const file of [...remoteFiles].sort((a, b) => a.path.localeCompare(b.path))) {
    const relPath = normalizeRelativePath(file.path);
    const existing = local.get(relPath);
    if (existing === file.content) {
      result.push({ path: relPath, status: "same" });
      continue;
    }

    if (existing !== undefined) {
      const source = pathWithinRoot(localRoot, relPath);
      const backup = pathWithinRoot(backupDir, relPath);
      await mkdir(dirname(backup), { recursive: true });
      await copyFile(source, backup);
      didBackup = true;
      await writeTextFileAtomic(localRoot, relPath, file.content);
      result.push({ path: relPath, status: "updated" });
    } else {
      await writeTextFileAtomic(localRoot, relPath, file.content);
      result.push({ path: relPath, status: "created" });
    }
  }

  return { files: result, backupDir: didBackup ? backupDir : undefined };
}

function printCounts(entries: Array<{ status: string }>): void {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
  console.log([...counts.entries()].map(([status, count]) => `${status}: ${count}`).join(", "));
}

export async function diffLayouts(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const remoteFiles = await fetchRemoteLayouts(adminUrlArg, selection.siteKey);
  const diff = await compareLayoutFiles(selection.layoutsRoot, remoteFiles);
  for (const entry of diff) console.log(`${entry.status}\t${entry.path}`);
  printCounts(diff);
}

export async function pullLayouts(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const remoteFiles = await fetchRemoteLayouts(adminUrlArg, selection.siteKey);
  const result = await pullLayoutFiles(selection.layoutsRoot, remoteFiles);
  for (const entry of result.files) console.log(`${entry.status}\t${entry.path}`);
  printCounts(result.files);
  if (result.backupDir) console.log(`Backup: ${result.backupDir}`);
}
