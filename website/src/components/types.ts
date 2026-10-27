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

export interface BlogPostSummary {
  key: string;
  locale: string;
  url: string;
  title: string;
  excerpt: string;
  coverImage: string;
  publishedAt: string | null;
  category: { key: string; name: string };
  tags: { key: string; name: string }[];
}

export interface BlogPostView extends BlogPostSummary {
  body: string;
  metaTitle: string;
  metaDescription: string;
  translations: { locale: string; url: string }[];
}

/**
 * Pages are pre-built under __page/N/. The website nginx template maps ?page=N
 * to those files; another web server or CDN must reproduce that mapping, or
 * pages 2+ stay unreachable. Page 1 uses the bare URL without a query parameter.
 * The editor preview pages through posts itself. Astro dev serves only page 1
 * unless a dev middleware provides the same mapping.
 */
export interface Pagination {
  current: number;
  total: number;
  prevUrl: string | null;
  nextUrl: string | null;
  pages: { number: number; url: string }[];
}

export interface BlogList {
  posts: BlogPostSummary[];
  pagination: Pagination | null;
}

export interface LayoutProps {
  content: ContentMap;
  navigation: NavigationItem[];
  locale: string;
  locales: LocaleOption[];
  settings: SiteSettings | null;
  blogLists: Record<string, BlogList>;
}

export type PostLayoutProps = LayoutProps & { post: BlogPostView };
