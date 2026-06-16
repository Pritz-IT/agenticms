import { loadCredential } from "./config.js";
import { requestJson } from "./http.js";

export interface CreateSiteOptions {
  key: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
  siteUrl?: string;
}

interface CreatedSite {
  key: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
  siteUrl: string | null;
}

function nextValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseCreateSiteArgs(args: string[]): CreateSiteOptions {
  const options: Partial<CreateSiteOptions> = {};

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--key") {
      options.key = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--name") {
      options.name = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--domain") {
      options.domain = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--staging-domain") {
      options.stagingDomain = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--default-locale") {
      options.defaultLocale = nextValue(args, i, arg);
      i += 1;
    } else if (arg === "--site-url") {
      options.siteUrl = nextValue(args, i, arg);
      i += 1;
    } else {
      throw new Error(`Unknown site create option: ${arg}`);
    }
  }

  const missing = [
    ["--key", options.key],
    ["--name", options.name],
    ["--domain", options.domain],
    ["--staging-domain", options.stagingDomain],
    ["--default-locale", options.defaultLocale],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`site create requires ${missing.map(([flag]) => flag).join(", ")}`);
  }

  return options as CreateSiteOptions;
}

export async function createSite(adminUrlArg: string | undefined, options: CreateSiteOptions): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const site = await requestJson<CreatedSite>(
    adminUrl,
    "/api/cli/sites",
    {
      method: "POST",
      body: JSON.stringify(options),
    },
    credential
  );

  console.log(`Created site: ${site.key}`);
  console.log(`Name: ${site.name}`);
  console.log(`Domain: ${site.domain}`);
  console.log(`Staging: ${site.stagingDomain}`);
}
