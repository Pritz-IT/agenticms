import { loadCredential, resolveSiteSelection } from "./config.js";
import { requestJson } from "./http.js";

interface BuildRow {
  id: string;
  target: "staging" | "production";
  status: "pending" | "building" | "success" | "failed";
  outputPath?: string | null;
  errorLog?: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function triggerBuild(
  adminUrlArg: string | undefined,
  target: string,
  projectRoot = process.cwd(),
  siteArg?: string
): Promise<void> {
  if (target !== "staging" && target !== "production") {
    throw new Error("Build target must be 'staging' or 'production'.");
  }

  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const created = await requestJson<BuildRow>(
    adminUrl,
    `/api/sites/${selection.siteKey}/cli/builds`,
    { method: "POST", body: JSON.stringify({ target }) },
    credential
  );
  console.log(`Build queued: ${created.id}`);

  for (let attempt = 0; attempt < 90; attempt += 1) {
    await sleep(2000);
    const current = await requestJson<BuildRow>(adminUrl, `/api/sites/${selection.siteKey}/cli/builds/${created.id}`, {}, credential);
    if (current.status === "success") {
      console.log(`Build succeeded: ${current.outputPath ?? ""}`);
      return;
    }
    if (current.status === "failed") {
      throw new Error(`Build failed: ${current.errorLog ?? "No error log returned"}`);
    }
    process.stdout.write(".");
  }

  throw new Error("Timed out waiting for build completion.");
}
