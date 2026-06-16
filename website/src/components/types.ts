export interface SiteSettings {
  id: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
}

export interface LocaleOption {
  id: string;
  code: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface NavigationItem {
  id: string;
  locale: string;
  label: string;
  targetPageId: string | null;
  targetPage?: {
    path: string;
  } | null;
  parentId: string | null;
  sortOrder: number;
  children: NavigationItem[];
}

export type ContentMap = Record<string, string>;

export interface LayoutProps {
  content: ContentMap;
  navigation: NavigationItem[];
  locale: string;
  locales: LocaleOption[];
  settings: SiteSettings | null;
}
