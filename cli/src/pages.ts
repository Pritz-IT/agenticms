import { loadCredential, resolveSiteSelection } from "./config.js";
import { requestJson } from "./http.js";

interface PageLayout {
  name: string;
  filePath: string;
}

interface PageRow {
  id: string;
  path: string;
  sortOrder: number;
  isPublished: boolean;
  layout: PageLayout | null;
}

export interface PageCreateOptions {
  path: string;
  layout?: string | null;
  sortOrder?: number;
  isPublished?: boolean;
}

export interface PageUpdateOptions {
  id: string;
  path?: string;
  layout?: string | null;
  sortOrder?: number;
  isPublished?: boolean;
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${flag} must be an integer`);
  }
  return parsed;
}

function parseLayoutValue(value: string): string | null {
  return value.trim() === "" ? null : value;
}

export function parsePageCreateArgs(args: string[]): PageCreateOptions {
  const options: Partial<PageCreateOptions> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--path") {
      options.path = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--layout") {
      options.layout = parseLayoutValue(nextValue(args, i, arg));
      i += 1;
    } else if (arg === "--sort-order") {
      options.sortOrder = parseInteger(nextValue(args, i, arg), arg);
      i += 1;
    } else if (arg === "--published") {
      options.isPublished = true;
    } else if (arg === "--draft") {
      options.isPublished = false;
    } else {
      throw new Error(`Unknown page create option: ${arg}`);
    }
  }

  if (!options.path) {
    throw new Error("page create requires --path");
  }

  return options as PageCreateOptions;
}

export function parsePageUpdateArgs(args: string[]): PageUpdateOptions {
  const options: Partial<PageUpdateOptions> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      options.id = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--path") {
      options.path = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--layout") {
      options.layout = parseLayoutValue(nextValue(args, i, arg));
      i += 1;
    } else if (arg === "--sort-order") {
      options.sortOrder = parseInteger(nextValue(args, i, arg), arg);
      i += 1;
    } else if (arg === "--published") {
      options.isPublished = true;
    } else if (arg === "--draft") {
      options.isPublished = false;
    } else {
      throw new Error(`Unknown page update option: ${arg}`);
    }
  }

  if (!options.id) {
    throw new Error("page update requires --id");
  }

  return options as PageUpdateOptions;
}

export function parsePageDeleteArgs(args: string[]): { id: string } {
  let id: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--id") {
      id = nextValue(args, i, arg);
      i += 1;
    } else {
      throw new Error(`Unknown page delete option: ${arg}`);
    }
  }

  if (!id) {
    throw new Error("page delete requires --id");
  }

  return { id };
}

function printPage(page: PageRow): void {
  const status = page.isPublished ? "published" : "draft";
  const layout = page.layout?.filePath ?? "no-layout";
  console.log(`${page.id}\t${page.path}\t${status}\t${layout}`);
}

export async function listPages(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const pages = await requestJson<PageRow[]>(
    adminUrl,
    `/api/sites/${selection.siteKey}/cli/pages`,
    {},
    credential
  );

  for (const page of pages) printPage(page);
}

export async function createPage(
  adminUrlArg: string | undefined,
  projectRoot: string,
  siteArg: string | undefined,
  options: PageCreateOptions
): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const page = await requestJson<PageRow>(
    adminUrl,
    `/api/sites/${selection.siteKey}/cli/pages`,
    { method: "POST", body: JSON.stringify(options) },
    credential
  );

  console.log(`Created page: ${page.path}`);
  console.log(`ID: ${page.id}`);
}

export async function updatePage(
  adminUrlArg: string | undefined,
  projectRoot: string,
  siteArg: string | undefined,
  options: PageUpdateOptions
): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const { id, ...payload } = options;
  const page = await requestJson<PageRow>(
    adminUrl,
    `/api/sites/${selection.siteKey}/cli/pages/${id}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    credential
  );

  console.log(`Updated page: ${page.path}`);
}

export async function deletePage(
  adminUrlArg: string | undefined,
  projectRoot: string,
  siteArg: string | undefined,
  id: string | undefined
): Promise<void> {
  if (!id) throw new Error("page delete requires --id <id>");

  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  await requestJson<{ ok: true }>(
    adminUrl,
    `/api/sites/${selection.siteKey}/cli/pages/${id}`,
    { method: "DELETE" },
    credential
  );

  console.log(`Deleted page: ${id}`);
}
