import { loadCredential, resolveSiteSelection } from "./config.js";
import { requestJson } from "./http.js";

function nextValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${flag} requires a value`);
  return v;
}

export function parseFormArgs(args: string[]): { form: string } {
  let form: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--form") { form = nextValue(args, i, "--form"); i += 1; }
    else throw new Error(`Unknown forms option: ${args[i]}`);
  }
  if (!form) throw new Error("forms add/remove requires --form <slug>");
  return { form };
}

export async function listForms(adminUrlArg: string | undefined, projectRoot: string, siteArg?: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const { forms } = await requestJson<{ forms: string[] }>(adminUrl, `/api/sites/${selection.siteKey}/cli/forms`, {}, credential);
  for (const f of forms) console.log(f);
}

export async function addForm(adminUrlArg: string | undefined, projectRoot: string, siteArg: string | undefined, form: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const { forms } = await requestJson<{ forms: string[] }>(adminUrl, `/api/sites/${selection.siteKey}/cli/forms`, { method: "POST", body: JSON.stringify({ form }) }, credential);
  console.log(`Allowed forms: ${forms.join(", ") || "(none)"}`);
}

export async function removeForm(adminUrlArg: string | undefined, projectRoot: string, siteArg: string | undefined, form: string): Promise<void> {
  const { adminUrl, credential } = await loadCredential(adminUrlArg);
  const selection = await resolveSiteSelection(projectRoot, siteArg);
  const { forms } = await requestJson<{ forms: string[] }>(adminUrl, `/api/sites/${selection.siteKey}/cli/forms/${encodeURIComponent(form)}`, { method: "DELETE" }, credential);
  console.log(`Allowed forms: ${forms.join(", ") || "(none)"}`);
}
