import { basename, dirname, resolve, sep } from "node:path";
import { readFile, realpath } from "node:fs/promises";
import { marked, Parser, type Token } from "marked";
import { loadCredential, resolveSiteSelection } from "./config.js";
import { CliHttpError, requestJson } from "./http.js";

export interface PostFrontmatter {
  key: string;
  locale: string;
  category: string;
  tags: string[];
  layout: string | null;
  title: string;
  slug: string;
  excerpt: string;
  cover: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
}

interface PushFile extends PostFrontmatter {
  source: string;
  html: string;
}

interface PushResponse {
  posts: Array<{ key: string; locale: string; action: string }>;
}

interface PostListRow {
  key: string;
  category: string;
  locales: Array<{ locale: string; status: string }>;
}

const REQUIRED_FIELDS = ["key", "locale", "category", "title", "slug"] as const;
const FRONTMATTER_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  "tags",
  "layout",
  "excerpt",
  "cover",
  "metaTitle",
  "metaDescription",
]);

function unquote(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
}

function frontmatterError(filePath: string, message: string): never {
  throw new Error(`${filePath}: ${message}`);
}

export function parsePostFile(filePath: string, text: string): { meta: PostFrontmatter; markdown: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) frontmatterError(filePath, "expected flat frontmatter enclosed by ---");

  const values: Record<string, string | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) frontmatterError(filePath, `invalid frontmatter line: ${line}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!FRONTMATTER_FIELDS.has(key)) frontmatterError(filePath, `unknown frontmatter key: ${key}`);
    if (key === "tags") {
      if (!value.startsWith("[") || !value.endsWith("]")) frontmatterError(filePath, "tags must be an inline list");
      values.tags = value.slice(1, -1).split(",").map((tag) => unquote(tag)).filter(Boolean);
    } else {
      values[key] = unquote(value);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (typeof values[field] !== "string" || !values[field]) frontmatterError(filePath, `missing required frontmatter: ${field}`);
  }

  return {
    meta: {
      key: values.key as string,
      locale: values.locale as string,
      category: values.category as string,
      tags: (values.tags as string[] | undefined) ?? [],
      layout: (values.layout as string | undefined) || null,
      title: values.title as string,
      slug: values.slug as string,
      excerpt: (values.excerpt as string | undefined) ?? "",
      cover: (values.cover as string | undefined) || null,
      metaTitle: (values.metaTitle as string | undefined) || null,
      metaDescription: (values.metaDescription as string | undefined) || null,
    },
    markdown: match[2],
  };
}

function imageHtml(href: string, title: string | null, text: string, figure: boolean): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const image = `<img src="${escape(href)}" alt="${escape(text)}">`;
  return figure ? `<figure>${image}${title ? `<figcaption>${escape(title)}</figcaption>` : ""}</figure>` : image;
}

export function markdownToHtml(markdown: string, mediaRefs = new Map<string, string>()): string {
  const renderer = new marked.Renderer();
  renderer.image = ({ href, title, text }) => {
    return imageHtml(mediaRefs.get(href) ?? href, title, text, true);
  };
  renderer.paragraph = ({ tokens }) => {
    if (tokens.every((token) => token.type === "image" || token.type === "br" || (token.type === "text" && !token.raw.trim()))) {
      return tokens.filter((token) => token.type === "image").map((token) => Parser.parseInline([token], { renderer })).join("");
    }
    const inlineRenderer = new marked.Renderer();
    inlineRenderer.image = ({ href, title, text }) => imageHtml(mediaRefs.get(href) ?? href, title, text, false);
    return `<p>${Parser.parseInline(tokens, { renderer: inlineRenderer })}</p>\n`;
  };
  return marked.parse(markdown, {
    gfm: true,
    renderer,
  }) as string;
}

function imageRefs(markdown: string): string[] {
  const refs = new Set<string>();
  marked.walkTokens(marked.lexer(markdown, { gfm: true }), (token: Token) => {
    if (token.type === "image") refs.add(token.href);
  });
  return [...refs];
}

function markdownHrefs(markdown: string): string[] {
  const refs = new Set<string>();
  marked.walkTokens(marked.lexer(markdown, { gfm: true }), (token: Token) => {
    if ((token.type === "image" || token.type === "link") && token.href) refs.add(token.href);
  });
  return [...refs];
}

type MediaFile = { ref: string; name: string; base64: string; realPath: string };

async function resolveMediaRefs(mdFile: string, refs: string[]): Promise<Map<string, MediaFile>> {
  const media = new Map<string, MediaFile>();
  const requestedBaseDir = resolve(dirname(mdFile));
  const baseDir = await realpath(requestedBaseDir);
  for (const ref of refs) {
    if (media.has(ref)) continue;
    if (ref.startsWith("/assets/") || ref.startsWith("/media/")) continue;
    if (/^https?:/i.test(ref)) throw new Error(`${mdFile}: external media URLs are not supported: ${ref}`);
    const requestedPath = resolve(requestedBaseDir, ref);
    if (requestedPath !== requestedBaseDir && !requestedPath.startsWith(requestedBaseDir + sep)) {
      throw new Error(`${mdFile}: media path escapes Markdown directory: ${ref}`);
    }
    const filePath = await realpath(requestedPath);
    if (filePath !== baseDir && !filePath.startsWith(baseDir + sep)) {
      throw new Error(`${mdFile}: media path escapes Markdown directory: ${ref}`);
    }
    const bytes = await readFile(filePath);
    media.set(ref, { ref, name: basename(filePath), base64: bytes.toString("base64"), realPath: filePath });
  }
  return media;
}

async function collectMediaFiles(mdFile: string, refs: string[]): Promise<MediaFile[]> {
  const media = new Map<string, MediaFile>();
  for (const file of (await resolveMediaRefs(mdFile, refs)).values()) media.set(file.realPath, file);
  return [...media.values()];
}

export async function collectMedia(mdFile: string, refs: string[]): Promise<Array<{ ref: string; name: string; base64: string }>> {
  return (await collectMediaFiles(mdFile, refs)).map(({ ref, name, base64 }) => ({ ref, name, base64 }));
}

export async function buildPushPayload(filePaths: string[], draft: boolean): Promise<{ draft: boolean; files: PushFile[]; media: Array<{ ref: string; name: string; base64: string }> }> {
  const parsedFiles = await Promise.all(filePaths.map(async (filePath) => ({ filePath, ...parsePostFile(filePath, await readFile(filePath, "utf8")) })));
  const files: PushFile[] = [];
  const media = new Map<string, { ref: string; name: string; base64: string }>();
  const reservedRefs = new Set(parsedFiles.flatMap(({ meta, markdown }) => [...markdownHrefs(markdown), ...(meta.cover ? [meta.cover] : [])]));
  let nextRef = 1;
  const createRef = (): string => {
    const ref = `agenticms-media-${nextRef++}`;
    if (reservedRefs.has(ref)) throw new Error(`Generated media ref collides with Markdown href: ${ref}`);
    return ref;
  };
  for (const { filePath, meta, markdown } of parsedFiles) {
    const refs = [...imageRefs(markdown), ...(meta.cover ? [meta.cover] : [])];
    const localMedia = await resolveMediaRefs(filePath, refs);
    const mediaRefs = new Map<string, string>();
    for (const [ref, item] of localMedia) {
      let upload = media.get(item.realPath);
      if (!upload) {
        upload = { ref: createRef(), name: item.name, base64: item.base64 };
        media.set(item.realPath, upload);
      }
      mediaRefs.set(ref, upload.ref);
    }
    files.push({
      source: filePath,
      ...meta,
      cover: meta.cover ? mediaRefs.get(meta.cover) ?? meta.cover : null,
      html: markdownToHtml(markdown, mediaRefs),
    });
  }
  return { draft, files, media: [...media.values()] };
}

export function parsePostPushArgs(args: string[]): { files: string[]; draft: boolean } {
  const files: string[] = [];
  let draft = false;
  for (const arg of args) {
    if (arg === "--draft") draft = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown push post option: ${arg}`);
    else files.push(arg);
  }
  if (files.length === 0) throw new Error("push post requires at least one Markdown file");
  return { files, draft };
}

function printIssues(error: CliHttpError): boolean {
  if (error.status !== 422) return false;
  try {
    const response = JSON.parse(error.message) as { issues?: Array<{ source: string; problem: string; detail: string }> };
    if (!Array.isArray(response.issues)) return false;
    for (const issue of response.issues) console.error(`${issue.source}: ${issue.problem} — ${issue.detail}`);
    return true;
  } catch {
    return false;
  }
}

export async function pushPosts(
  adminUrlArg: string | undefined,
  projectRoot: string,
  siteArg: string | undefined,
  filePaths: string[],
  draft: boolean
): Promise<void> {
  const payload = await buildPushPayload(filePaths, draft);

  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  try {
    const result = await requestJson<PushResponse>(
      adminUrl,
      `/api/sites/${selection.siteKey}/cli/posts/push`,
      { method: "POST", body: JSON.stringify(payload) },
      credential
    );
    for (const post of result.posts) console.log(`${post.key}\t${post.locale}\t${post.action}`);
  } catch (error) {
    if (error instanceof CliHttpError && printIssues(error)) {
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

export async function listPosts(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const posts = await requestJson<PostListRow[]>(adminUrl, `/api/sites/${selection.siteKey}/cli/posts`, {}, credential);
  for (const post of posts) console.log(`${post.key}\t${post.category}\t${post.locales.map(({ locale, status }) => `${locale}:${status}`).join(",")}`);
}
