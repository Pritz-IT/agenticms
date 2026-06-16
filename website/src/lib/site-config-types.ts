export interface SiteSettings {
  id: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
  siteUrl?: string | null;
}

export interface Locale {
  id: string;
  code: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface Layout {
  id: string;
  name: string;
  filePath: string;
  detectedKeys: Record<string, { type: string; initial: string }>;
  registeredAt: string;
  updatedAt: string;
}

export interface Content {
  id: string;
  pageId: string;
  key: string;
  locale: string;
  value: string;
  type: string;
}

export interface Page {
  id: string;
  path: string;
  layoutId: string | null;
  sortOrder: number;
  isPublished: boolean;
  layout: Layout | null;
  contents: Content[];
}

export interface Navigation {
  id: string;
  locale: string;
  label: string;
  targetPageId: string | null;
  targetPage: Page | null;
  parentId: string | null;
  sortOrder: number;
  children: Navigation[];
}

export interface StagingAccess {
  id: string;
  username: string;
  passwordHash: string;
  expiresAt: string | null;
}

export interface AssetRef {
  id: string;
  filename: string;
  filePath: string;
}

export interface SiteConfig {
  settings: SiteSettings | null;
  locales: Locale[];
  layouts: Layout[];
  pages: Page[];
  navigation: Navigation[];
  stagingAccess: StagingAccess[];
  assets: AssetRef[];
}
