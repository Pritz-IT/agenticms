export const DEFAULT_SITE_KEY = "demo";

export function legacySitePath(section: string): string {
  return `/sites/${DEFAULT_SITE_KEY}/${section}`;
}

export function siteSectionPath(siteKey: string, section: string): string {
  return `/sites/${siteKey}/${section}`;
}

export function replaceSiteKeyInPath(pathname: string, currentSiteKey: string, nextSiteKey: string): string {
  const currentPrefix = `/sites/${currentSiteKey}/`;
  if (pathname.startsWith(currentPrefix)) {
    const section = pathname.slice(currentPrefix.length).split("/")[0];
    if (section === "pages" && pathname.slice(currentPrefix.length).split("/").length > 1) {
      return siteSectionPath(nextSiteKey, "pages");
    }
    return pathname.replace(currentPrefix, `/sites/${nextSiteKey}/`);
  }
  return siteSectionPath(nextSiteKey, "pages");
}
