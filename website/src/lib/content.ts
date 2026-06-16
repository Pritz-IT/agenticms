import type { Page, Content, Layout } from "./site-config-types";

/**
 * Resolves content for a page and locale using a three-step fallback chain:
 * 1. Content entry for (key, locale) — use if has value
 * 2. Content entry for (key, defaultLocale) — use if has value
 * 3. The key's initial value from the layout's detectedKeys
 */
export function resolveContent(
  page: Page,
  locale: string,
  defaultLocale: string
): Record<string, string> {
  const layout: Layout | null = page.layout;
  const detectedKeys: Record<string, { type: string; initial: string }> =
    layout?.detectedKeys ?? {};

  const contentsByKey = new Map<string, Content[]>();
  for (const entry of page.contents) {
    const existing = contentsByKey.get(entry.key) ?? [];
    existing.push(entry);
    contentsByKey.set(entry.key, existing);
  }

  const result: Record<string, string> = {};

  for (const [key, keyMeta] of Object.entries(detectedKeys)) {
    const entries = contentsByKey.get(key) ?? [];

    const forLocale = entries.find((e) => e.locale === locale && e.value !== "");
    if (forLocale) {
      result[key] = forLocale.value;
      continue;
    }

    const forDefault = entries.find(
      (e) => e.locale === defaultLocale && e.value !== ""
    );
    if (forDefault) {
      result[key] = forDefault.value;
      continue;
    }

    result[key] = keyMeta.initial;
  }

  return result;
}
