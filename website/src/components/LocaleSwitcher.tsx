import React from "react";
import type { Locale } from "../lib/site-config-types";

interface LocaleSwitcherProps {
  currentLocale: string;
  locales: Locale[];
  currentPath: string;
  defaultLocale: string;
}

function buildLocalePath(
  targetLocale: string,
  currentPath: string,
  currentLocale: string,
  defaultLocale: string
): string {
  // Strip leading slash
  let path = currentPath.replace(/^\//, "");

  // Strip current locale prefix if not default
  if (currentLocale !== defaultLocale && path.startsWith(currentLocale)) {
    path = path.slice(currentLocale.length).replace(/^\//, "");
  }

  // Build new path with target locale prefix
  if (targetLocale === defaultLocale) {
    return path ? `/${path}` : "/";
  } else {
    return path ? `/${targetLocale}/${path}` : `/${targetLocale}`;
  }
}

export default function LocaleSwitcher({
  currentLocale,
  locales,
  currentPath,
  defaultLocale,
}: LocaleSwitcherProps) {
  return (
    <nav aria-label="Language switcher">
      {locales.map((locale) => {
        const href = buildLocalePath(
          locale.code,
          currentPath,
          currentLocale,
          defaultLocale
        );
        const isCurrent = locale.code === currentLocale;
        return (
          <a
            key={locale.code}
            href={href}
            lang={locale.code}
            aria-current={isCurrent ? "page" : undefined}
            style={{ fontWeight: isCurrent ? "bold" : "normal", marginRight: "0.5rem" }}
          >
            {locale.label}
          </a>
        );
      })}
    </nav>
  );
}
