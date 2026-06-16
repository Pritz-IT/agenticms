import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export interface StoredCredential {
  token: string;
  expiresAt: string;
}

export interface CredentialStore {
  currentAdminUrl?: string;
  credentials: Record<string, StoredCredential>;
}

export interface SiteSelection {
  siteKey: string;
  layoutsRoot: string;
  assetsRoot: string;
}

export interface GlobalLayoutSelection {
  globalLayoutsRoot: string;
}

export interface GlobalAssetSelection {
  globalAssetsRoot: string;
}

export interface SiteConfigFile {
  site?: string;
  globalLayouts?: string;
  globalAssets?: string;
  sites?: Record<string, { layouts?: string; assets?: string }>;
}

function assertSiteKey(siteKey: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(siteKey)) {
    throw new Error(`Invalid site key: ${siteKey}`);
  }
  return siteKey;
}

function resolveConfiguredRoot(agenticmsRoot: string, configuredPath: string, label: string): string {
  const root = resolve(agenticmsRoot);
  const selected = resolve(root, configuredPath);
  if (selected !== root && !selected.startsWith(root + sep)) {
    throw new Error(`${label} site root escapes .agenticms: ${configuredPath}`);
  }
  return selected;
}

export function normalizeAdminUrl(input: string): string {
  const url = new URL(input);
  if (url.username || url.password) {
    throw new Error("Admin URL must not contain credentials.");
  }
  const isLocalHttpHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol === "http:" && !isLocalHttpHost) {
    throw new Error("Refusing non-local HTTP admin URL. Use HTTPS, or localhost for development.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Admin URL must use http or https.");
  }
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function defaultCredentialsPath(): string {
  return join(homedir(), ".agenticms", "credentials.json");
}

export async function readCredentialStore(path = defaultCredentialsPath()): Promise<CredentialStore> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CredentialStore>;
    const credentials: Record<string, StoredCredential> = {};
    for (const [adminUrl, credential] of Object.entries(parsed.credentials ?? {})) {
      try {
        credentials[normalizeAdminUrl(adminUrl)] = credential;
      } catch {
        // Drop legacy or hand-edited credential keys that are no longer safe.
      }
    }

    let currentAdminUrl: string | undefined;
    if (parsed.currentAdminUrl) {
      try {
        currentAdminUrl = normalizeAdminUrl(parsed.currentAdminUrl);
      } catch {
        currentAdminUrl = undefined;
      }
    }
    return {
      currentAdminUrl: currentAdminUrl && credentials[currentAdminUrl] ? currentAdminUrl : undefined,
      credentials,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { credentials: {} };
    }
    throw err;
  }
}

export async function writeCredentialStore(store: CredentialStore, path = defaultCredentialsPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

export async function saveCredential(
  adminUrl: string,
  credential: StoredCredential,
  path = defaultCredentialsPath()
): Promise<void> {
  const normalized = normalizeAdminUrl(adminUrl);
  const store = await readCredentialStore(path);
  store.currentAdminUrl = normalized;
  store.credentials[normalized] = credential;
  await writeCredentialStore(store, path);
}

export async function loadCredential(adminUrl?: string, path = defaultCredentialsPath()): Promise<{
  adminUrl: string;
  credential: StoredCredential;
}> {
  const store = await readCredentialStore(path);
  const resolvedUrl = adminUrl ? normalizeAdminUrl(adminUrl) : store.currentAdminUrl;
  if (!resolvedUrl) throw new Error("No AgentiCMS admin URL configured. Run `agenticms login <url>` first.");

  const credential = store.credentials[resolvedUrl];
  if (!credential) throw new Error(`No credentials stored for ${resolvedUrl}. Run \`agenticms login ${resolvedUrl}\`.`);
  return { adminUrl: resolvedUrl, credential };
}

export async function removeCredential(adminUrl?: string, path = defaultCredentialsPath()): Promise<string> {
  const store = await readCredentialStore(path);
  const resolvedUrl = adminUrl ? normalizeAdminUrl(adminUrl) : store.currentAdminUrl;
  if (!resolvedUrl) throw new Error("No AgentiCMS admin URL configured.");
  delete store.credentials[resolvedUrl];
  if (store.currentAdminUrl === resolvedUrl) {
    store.currentAdminUrl = Object.keys(store.credentials)[0];
  }
  await writeCredentialStore(store, path);
  return resolvedUrl;
}

export async function resolveSiteSelection(projectRoot: string, explicitSite?: string): Promise<SiteSelection> {
  const siteConfigPath = join(projectRoot, ".agenticms", "site.json");
  const parsed: SiteConfigFile = await readFile(siteConfigPath, "utf-8")
    .then((raw) => JSON.parse(raw) as SiteConfigFile)
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    });
  const siteKey = explicitSite ?? parsed.site;
  if (!siteKey) throw new Error("No site selected. Pass --site <key> or create .agenticms/site.json.");
  const safeSiteKey = assertSiteKey(siteKey);
  const agenticmsRoot = join(projectRoot, ".agenticms");
  const local = parsed.sites?.[siteKey] ?? {};
  return {
    siteKey: safeSiteKey,
    layoutsRoot: resolveConfiguredRoot(agenticmsRoot, local.layouts ?? "layouts", "layouts"),
    assetsRoot: resolveConfiguredRoot(agenticmsRoot, local.assets ?? "assets", "assets"),
  };
}

export async function resolveGlobalLayoutSelection(projectRoot: string): Promise<GlobalLayoutSelection> {
  const siteConfigPath = join(projectRoot, ".agenticms", "site.json");
  const parsed: SiteConfigFile = await readFile(siteConfigPath, "utf-8")
    .then((raw) => JSON.parse(raw) as SiteConfigFile)
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    });
  const agenticmsRoot = join(projectRoot, ".agenticms");
  return {
    globalLayoutsRoot: resolveConfiguredRoot(agenticmsRoot, parsed.globalLayouts ?? "layouts/_global", "global layouts"),
  };
}

export async function resolveGlobalAssetSelection(projectRoot: string): Promise<GlobalAssetSelection> {
  const siteConfigPath = join(projectRoot, ".agenticms", "site.json");
  const parsed: SiteConfigFile = await readFile(siteConfigPath, "utf-8")
    .then((raw) => JSON.parse(raw) as SiteConfigFile)
    .catch((err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    });
  const agenticmsRoot = join(projectRoot, ".agenticms");
  return {
    globalAssetsRoot: resolveConfiguredRoot(agenticmsRoot, parsed.globalAssets ?? "assets/_global", "global assets"),
  };
}
