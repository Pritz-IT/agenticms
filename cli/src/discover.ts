import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface TextUploadFile {
  path: string;
  content: string;
}

export interface Base64UploadFile {
  path: string;
  base64: string;
}

const ASSET_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".ico",
  ".pdf",
  ".json",
  ".js",
  ".mjs",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp4",
  ".webm",
]);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function toUploadPath(root: string, file: string): string {
  return relative(root, file).split(/[\\/]+/).join("/");
}

function hasHiddenSegment(uploadPath: string): boolean {
  return uploadPath.split("/").some((segment) => segment.startsWith("."));
}

export async function discoverLayoutFiles(root: string): Promise<TextUploadFile[]> {
  const files = (await walk(root))
    .filter((file) => [".tsx", ".ts"].includes(extname(file).toLowerCase()))
    .filter((file) => !hasHiddenSegment(toUploadPath(root, file)))
    .sort();
  return Promise.all(files.map(async (file) => ({
    path: toUploadPath(root, file),
    content: await readFile(file, "utf-8"),
  })));
}

export async function discoverAssetFiles(root: string): Promise<Base64UploadFile[]> {
  const files = (await walk(root))
    .filter((file) => ASSET_EXTENSIONS.has(extname(file).toLowerCase()))
    .filter((file) => !hasHiddenSegment(toUploadPath(root, file)))
    .sort();
  return Promise.all(files.map(async (file) => ({
    path: toUploadPath(root, file),
    base64: (await readFile(file)).toString("base64"),
  })));
}
