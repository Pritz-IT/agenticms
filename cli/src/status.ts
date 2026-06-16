import { loadCredential, resolveSiteSelection } from "./config.js";
import { requestJson } from "./http.js";

interface StatusResponse {
  user: { email: string; role: string };
  layouts: number;
  assets: number;
  latestBuild: { id: string; target: string; status: string } | null;
}

export async function status(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const result = await requestJson<StatusResponse>(adminUrl, `/api/sites/${selection.siteKey}/cli/status`, {}, credential);
  console.log(`Admin: ${adminUrl}`);
  console.log(`Site: ${selection.siteKey}`);
  console.log(`User: ${result.user.email} (${result.user.role})`);
  console.log(`Layouts: ${result.layouts}`);
  console.log(`Assets: ${result.assets}`);
  console.log(`Latest build: ${result.latestBuild ? `${result.latestBuild.target} ${result.latestBuild.status}` : "none"}`);
}
