export interface User {
  id: string;
  email: string;
  role: "admin" | "editor";
  createdAt: string;
}

export interface LoginResponse {
  accessToken: string;
  user: User;
}

export interface Settings {
  id: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
  siteUrl: string | null;
}

export interface Site {
  id: string;
  key: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
  siteUrl: string | null;
}

export interface Locale {
  id: string;
  code: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface LayoutKey {
  type: "text" | "richtext" | "image" | "link" | "page" | "navigation";
  initial: string;
}

export interface Layout {
  id: string;
  name: string;
  filePath: string;
  detectedKeys: Record<string, LayoutKey>;
  globalTemplateId?: string | null;
  globalTemplateHash?: string | null;
  globalTemplate?: LayoutGlobalTemplateMeta | null;
  registeredAt: string;
  updatedAt: string;
}

export interface GlobalLayoutTemplate {
  id: string;
  key: string;
  name: string;
  filePath: string;
  detectedKeys: Record<string, LayoutKey>;
  sourceHash: string;
  registeredAt: string;
  updatedAt: string;
}

export interface LayoutGlobalTemplateMeta {
  id: string;
  key: string;
  name: string;
  differsFromSiteCopy: boolean;
}

export interface Page {
  id: string;
  path: string;
  layoutId: string;
  sortOrder: number;
  isPublished: boolean;
  layout?: Layout;
  contents?: Content[];
}

export type ContentType = "text" | "richtext" | "image" | "link" | "page";
export type LayoutKeyType = ContentType | "navigation";

export interface Content {
  id: string;
  pageId: string;
  key: string;
  locale: string;
  value: string;
  type: ContentType;
}

export interface NavigationItem {
  id: string;
  locale: string;
  label: string;
  targetPageId: string | null;
  targetPage?: Page | null;
  parentId: string | null;
  sortOrder: number;
  children?: NavigationItem[];
}

export interface Asset {
  id: string;
  filename: string;
  mimeType: string;
  filePath: string;
  uploadedAt: string;
  uploadedBy: string;
  globalAssetId?: string | null;
  globalAssetHash?: string | null;
  globalAsset?: AssetGlobalMeta | null;
  differsFromGlobal?: boolean;
}

export interface AssetGlobalMeta {
  id: string;
  key: string;
  mode: "shared" | "copyable";
  filePath: string;
  sourceHash: string;
}

export type AssetLibraryItem =
  | (Asset & { scope: "site"; deletable: true })
  | {
      id: string;
      filename: string;
      mimeType: string;
      filePath: string;
      uploadedAt: string;
      uploadedBy: "global";
      scope: "global-shared";
      deletable: false;
    };

export interface StagingAccess {
  id: string;
  username: string;
  expiresAt: string;
}

export type BuildTarget = "staging" | "production";
export type BuildStatus = "pending" | "building" | "success" | "failed";

export interface Build {
  id: string;
  target: BuildTarget;
  status: BuildStatus;
  outputPath: string | null;
  startedAt: string;
  finishedAt: string | null;
  errorLog: string | null;
}

export interface Submission {
  id: string;
  siteId: string;
  form: string;
  data: Record<string, unknown>;
  score: number | null;
  email: string | null;
  wantsContact: boolean;
  createdAt: string;
}
