import type { SiteConfig, Locale } from "./site-config-types";
import rawConfig from "../data/config.json";

const siteConfig = rawConfig as unknown as SiteConfig;

export function getConfig(): SiteConfig {
  return siteConfig;
}

export function getDefaultLocale(): string {
  const locale = siteConfig.locales.find(
    (l: Locale) => l.isDefault
  );
  return locale?.code ?? siteConfig.settings?.defaultLocale ?? "";
}
