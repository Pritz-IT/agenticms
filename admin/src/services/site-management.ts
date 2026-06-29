import type { PrismaClient, Site } from "@prisma/client";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

export interface CreateSiteInput {
  key?: string;
  name?: string;
  domain?: string;
  stagingDomain?: string;
  defaultLocale?: string;
  siteUrl?: string | null;
  localeLabel?: string;
}

export interface SiteWithLocale extends Site {
  locales: Array<{
    id: string;
    siteId: string;
    code: string;
    label: string;
    isDefault: boolean;
    sortOrder: number;
  }>;
}

const SITE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const LOCALE_RE = /^[a-z]{2}(?:-[A-Z]{2})?$/;
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function normalizeSiteKey(value: unknown): string {
  const key = requiredString(value, "key").toLowerCase();
  if (!SITE_KEY_RE.test(key)) {
    throw new Error("key must be a lowercase slug with letters, numbers, and hyphens");
  }
  return key;
}

function normalizeLocale(value: unknown): string {
  const locale = requiredString(value, "defaultLocale");
  if (!LOCALE_RE.test(locale)) {
    throw new Error("defaultLocale must look like de or en-US");
  }
  return locale;
}

function extractHost(value: string, label: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.includes(";") || trimmed.includes(" ") || trimmed.includes("\n") || trimmed.includes("\t")) {
    throw new Error(`${label} contains invalid characters`);
  }

  const host = trimmed.includes("://") ? new URL(trimmed).hostname.toLowerCase() : trimmed;
  if (host.includes("/") || host.includes(":") || !HOST_RE.test(host) || host.includes("..")) {
    throw new Error(`${label} must be a hostname`);
  }
  return host;
}

function normalizeUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = requiredString(value, "siteUrl");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("siteUrl must use http or https");
  }
  extractHost(url.hostname, "siteUrl");
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeCreateSiteInput(input: CreateSiteInput): Required<Omit<CreateSiteInput, "siteUrl" | "localeLabel">> & {
  siteUrl: string | null;
  localeLabel: string;
} {
  const key = normalizeSiteKey(input.key);
  const name = requiredString(input.name, "name");
  const domain = extractHost(requiredString(input.domain, "domain"), "domain");
  const stagingDomain = extractHost(requiredString(input.stagingDomain, "stagingDomain"), "stagingDomain");
  const defaultLocale = normalizeLocale(input.defaultLocale);
  const siteUrl = normalizeUrl(input.siteUrl);
  const localeLabel = typeof input.localeLabel === "string" && input.localeLabel.trim()
    ? input.localeLabel.trim()
    : defaultLocale.toUpperCase();

  return { key, name, domain, stagingDomain, defaultLocale, siteUrl, localeLabel };
}

export async function ensureSiteDirectories(siteKey: string): Promise<void> {
  await Promise.all([
    mkdir(join(config.LAYOUTS_DIR, siteKey), { recursive: true }),
    mkdir(join(config.ASSETS_DIR, siteKey), { recursive: true }),
    mkdir(join(config.BUILDS_DIR, siteKey), { recursive: true }),
  ]);
}

export async function createSite(prisma: PrismaClient, input: CreateSiteInput): Promise<SiteWithLocale> {
  const data = normalizeCreateSiteInput(input);
  await ensureSiteDirectories(data.key);

  const site = await prisma.site.create({
    data: {
      key: data.key,
      name: data.name,
      domain: data.domain,
      stagingDomain: data.stagingDomain,
      defaultLocale: data.defaultLocale,
      siteUrl: data.siteUrl,
      locales: {
        create: {
          code: data.defaultLocale,
          label: data.localeLabel,
          isDefault: true,
          sortOrder: 0,
        },
      },
    },
    include: { locales: true },
  });

  return site;
}

export function hostMapLines(sites: Pick<Site, "key" | "domain" | "stagingDomain" | "siteUrl">[]): string[] {
  const defaultKey = sites.find((site) => site.key === "demo")?.key ?? sites[0]?.key ?? "demo";
  const lines = [`default ${defaultKey};`];
  const seen = new Set<string>();

  for (const site of sites) {
    const baseHosts = [
      extractHost(site.domain, "domain"),
      extractHost(site.stagingDomain, "stagingDomain"),
      ...(site.siteUrl ? [extractHost(new URL(site.siteUrl).hostname, "siteUrl")] : []),
    ];

    // Also serve the `www.` variant of every host, so visitors who type
    // `www.<domain>` reach the site directly instead of falling through to the
    // default site. Hosts that are already `www.`-prefixed are left untouched.
    // Explicitly configured hosts still win on collision via the `seen` set.
    const hosts = baseHosts.flatMap((host) =>
      host.startsWith("www.") ? [host] : [host, `www.${host}`],
    );

    for (const host of hosts) {
      if (seen.has(host)) continue;
      seen.add(host);
      lines.push(`${host} ${site.key};`);
    }
  }

  return lines;
}

export async function generateNginxHostMap(prisma: PrismaClient): Promise<string> {
  const sites = await prisma.site.findMany({
    orderBy: { name: "asc" },
    select: {
      key: true,
      domain: true,
      stagingDomain: true,
      siteUrl: true,
    },
  });
  return `${hostMapLines(sites).join("\n")}\n`;
}

export async function generateSiteKeys(prisma: PrismaClient): Promise<string> {
  const sites = await prisma.site.findMany({ orderBy: { name: "asc" }, select: { key: true } });
  return `${sites.map((site) => site.key).join(" ")}\n`;
}
