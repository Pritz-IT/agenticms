import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { config } from "../config.js";

const gzipAsync = promisify(gzip);
const TAR_BLOCK_SIZE = 512;

interface TarEntry {
  mode: number;
  name: string;
  content: Buffer;
}

interface FileInfo {
  path: string;
  tarPath: string;
  size: number;
  hash: string;
}

interface CliArchiveCacheEntry {
  key: string;
  archive: CliArchive;
}

export interface CliArchive {
  buffer: Buffer;
  etag: string;
}

let archiveCache: CliArchiveCacheEntry | undefined;

function strongEtag(prefix: string, input: string | Buffer): string {
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 24);
  return `"${prefix}:${hash}"`;
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const octal = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  buffer.write(octal, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function tarHeader(entry: TarEntry): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  header.write(entry.name, 0, 100, "utf8");
  writeOctal(header, entry.mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, entry.content.length, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(" ", 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar", 257, 5, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 8);
  return header;
}

function padTarContent(content: Buffer): Buffer {
  const remainder = content.length % TAR_BLOCK_SIZE;
  if (remainder === 0) return content;
  return Buffer.concat([content, Buffer.alloc(TAR_BLOCK_SIZE - remainder, 0)]);
}

function buildTar(entries: TarEntry[]): Buffer {
  return Buffer.concat([
    ...entries.flatMap((entry) => [tarHeader(entry), padTarContent(entry.content)]),
    Buffer.alloc(TAR_BLOCK_SIZE * 2, 0),
  ]);
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function toTarPath(path: string): string {
  return path.split(sep).join("/");
}

async function collectCliFiles(root: string, distDir: string, packageJsonPath: string): Promise<FileInfo[]> {
  await stat(join(distDir, "main.js"));
  const packageJsonContent = await readFile(packageJsonPath);

  const files: FileInfo[] = [
    {
      path: packageJsonPath,
      tarPath: "package.json",
      size: packageJsonContent.length,
      hash: createHash("sha256").update(packageJsonContent).digest("hex"),
    },
  ];

  for (const filePath of (await walkFiles(distDir)).sort()) {
    const content = await readFile(filePath);
    files.push({
      path: filePath,
      tarPath: toTarPath(relative(root, filePath)),
      size: content.length,
      hash: createHash("sha256").update(content).digest("hex"),
    });
  }

  return files;
}

function archiveCacheKey(packageDir: string, files: FileInfo[]): string {
  return JSON.stringify({
    packageDir,
    files: files.map((file) => [file.tarPath, file.size, file.hash]),
  });
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function cliInstallerScript(adminOrigin: string): string {
  return `#!/bin/sh
set -eu

DEFAULT_AGENTICMS_ADMIN_URL=${shellSingleQuote(adminOrigin)}
AGENTICMS_ADMIN_URL="\${AGENTICMS_ADMIN_URL:-$DEFAULT_AGENTICMS_ADMIN_URL}"
INSTALL_DIR="\${AGENTICMS_CLI_HOME:-$HOME/.agenticms/cli}"
BIN_DIR="\${AGENTICMS_BIN_DIR:-$HOME/.agenticms/bin}"
TMP_DIR="\${TMPDIR:-/tmp}/agenticms-cli-install-$$"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TMP_DIR" "$INSTALL_DIR" "$BIN_DIR"
curl -fsSL "$AGENTICMS_ADMIN_URL/api/cli/agenticms-cli.tar.gz" -o "$TMP_DIR/agenticms-cli.tar.gz"
tar -xzf "$TMP_DIR/agenticms-cli.tar.gz" -C "$TMP_DIR"
rm -rf "$INSTALL_DIR"
mv "$TMP_DIR/agenticms-cli" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/dist/main.js"
ln -sfn "$INSTALL_DIR/dist/main.js" "$BIN_DIR/agenticms"

echo "AgentiCMS CLI installed at $BIN_DIR/agenticms"
echo "Add $BIN_DIR to PATH if needed, then run:"
echo "  agenticms login \\"$AGENTICMS_ADMIN_URL\\""
"$BIN_DIR/agenticms" login "$AGENTICMS_ADMIN_URL"
`;
}

export function cliInstallerScriptWithEtag(adminOrigin: string): { script: string; etag: string } {
  const script = cliInstallerScript(adminOrigin);
  return { script, etag: strongEtag("agenticms-cli-install", script) };
}

export async function getCliArchive(packageDir = config.CLI_PACKAGE_DIR): Promise<CliArchive> {
  const root = resolve(packageDir);
  const packageJsonPath = join(root, "package.json");
  const distDir = join(root, "dist");
  const files = await collectCliFiles(root, distDir, packageJsonPath);
  const key = archiveCacheKey(root, files);

  if (archiveCache?.key === key) {
    return archiveCache.archive;
  }

  const entries: TarEntry[] = [];
  for (const file of files) {
    entries.push({
      name: `agenticms-cli/${file.tarPath}`,
      mode: file.tarPath === "dist/main.js" ? 0o755 : 0o644,
      content: await readFile(file.path),
    });
  }

  const buffer = await gzipAsync(buildTar(entries), { level: 6 });
  const archive = { buffer, etag: strongEtag("agenticms-cli-archive", key) };
  archiveCache = { key, archive };
  return archive;
}

export async function buildCliArchive(packageDir = config.CLI_PACKAGE_DIR): Promise<Buffer> {
  return (await getCliArchive(packageDir)).buffer;
}
