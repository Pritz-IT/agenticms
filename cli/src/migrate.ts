import { loadCredential, resolveSiteSelection } from "./config.js";
import { requestJson } from "./http.js";

interface AssetMigrationResponse {
  scanned: number;
  migrated: number;
  filesCopied: number;
  filesAlreadyPresent: number;
  missingFiles: string[];
  contentUpdated: number;
  layoutsUpdated: number;
}

export async function migrateAssets(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const result = await requestJson<AssetMigrationResponse>(
    adminUrl,
    `/api/sites/${selection.siteKey}/assets/migrate-legacy`,
    { method: "POST" },
    credential
  );

  console.log(`Legacy assets migrated: ${result.migrated}/${result.scanned}`);
  console.log(`Files: ${result.filesCopied} copied, ${result.filesAlreadyPresent} already present, ${result.missingFiles.length} missing`);
  console.log(`References: ${result.contentUpdated} content rows, ${result.layoutsUpdated} layouts`);
  if (result.missingFiles.length > 0) {
    console.log(`Missing: ${result.missingFiles.join(", ")}`);
  }
}
