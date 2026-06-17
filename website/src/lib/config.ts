import type { SiteConfig, Locale } from "./site-config-types";
import fallbackConfig from "../data/default-config.json";

const configModules = import.meta.glob("../data/config.json", { eager: true });
const generatedConfig = configModules["../data/config.json"] as
  | { default: unknown }
  | undefined;

const siteConfig = (generatedConfig?.default ?? fallbackConfig) as SiteConfig;

export function getConfig(): SiteConfig {
  return siteConfig;
}

export function getDefaultLocale(): string {
  const locale = siteConfig.locales.find(
    (l: Locale) => l.isDefault
  );
  return locale?.code ?? siteConfig.settings?.defaultLocale ?? "";
}
