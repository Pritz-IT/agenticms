// ponytail: mirrors website/src/lib/routes.ts
export function pageRouteSlug(
  pagePath: string,
  locale: string,
  defaultLocale: string
): string | undefined {
  const stripped = pagePath.replace(/^\//, "");
  const isHomepage = stripped === "" || stripped === "/";
  const isDefault = locale === defaultLocale;

  if (isHomepage) {
    return isDefault ? undefined : locale;
  }
  return isDefault ? stripped : `${locale}/${stripped}`;
}

// ponytail: mirrors website/src/lib/routes.ts
export function slugToUrlPath(slug?: string): string {
  return slug ? `/${slug}/` : "/";
}

export function postUrlPath(categoryPagePath: string, locale: string, defaultLocale: string, slug: string): string {
  const base = pageRouteSlug(categoryPagePath, locale, defaultLocale);
  return slugToUrlPath(base ? `${base}/${slug}` : slug);
}
