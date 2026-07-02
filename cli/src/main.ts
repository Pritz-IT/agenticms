#!/usr/bin/env node
import { login } from "./login.js";
import { status } from "./status.js";
import { logout } from "./logout.js";
import { syncAll, syncAssets, syncLayouts } from "./sync.js";
import { triggerBuild } from "./build.js";
import { diffLayouts, pullLayouts } from "./layout-pull.js";
import { createSite, parseCreateSiteArgs } from "./sites.js";
import { migrateAssets } from "./migrate.js";
import {
  createPage,
  deletePage,
  listPages,
  parsePageCreateArgs,
  parsePageDeleteArgs,
  parsePageUpdateArgs,
  updatePage,
} from "./pages.js";
import { addForm, listForms, parseFormArgs, removeForm } from "./forms.js";

interface ParsedArgs {
  args: string[];
  adminUrl?: string;
  projectRoot: string;
  revoke: boolean;
  site?: string;
  global: boolean;
  template?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: string[] = [];
  let adminUrl: string | undefined;
  let projectRoot = process.cwd();
  let revoke = false;
  let site: string | undefined;
  let global = false;
  let template: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--url") {
      adminUrl = argv[++i];
    } else if (value === "--project-root") {
      projectRoot = argv[++i] ?? projectRoot;
    } else if (value === "--site") {
      site = argv[++i];
    } else if (value === "--global") {
      global = true;
    } else if (value === "--template") {
      template = argv[++i];
    } else if (value === "--revoke") {
      revoke = true;
    } else {
      args.push(value);
    }
  }

  return { args, adminUrl, projectRoot, revoke, site, global, template };
}

function usage(): string {
  return [
    "Usage:",
    "  agenticms login <admin-url>",
    "  agenticms status [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms sync [layouts|assets] [--global] [--template <key>] [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms migrate assets [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms diff layouts [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms pull layouts [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms site create --key <key> --name <name> --domain <host> --staging-domain <host> --default-locale <locale> [--site-url <url>] [--url <admin-url>]",
    "  agenticms page list [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms page create --path <path> [--layout <layout>] [--sort-order <n>] [--published|--draft] [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms page update --id <id> [--path <path>] [--layout <layout>] [--sort-order <n>] [--published|--draft] [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms page delete --id <id> [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms forms list [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms forms add --form <slug> [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms forms remove --form <slug> [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms build <staging|production> [--url <admin-url>] [--project-root <path>] [--site <key>]",
    "  agenticms logout [--url <admin-url>] [--revoke]",
  ].join("\n");
}

async function run(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command, subcommand] = parsed.args;

  if (command === "login") {
    if (!subcommand) throw new Error("login requires an admin URL.\n" + usage());
    await login(subcommand);
    return;
  }

  if (command === "status") {
    await status(parsed.adminUrl, parsed.projectRoot, parsed.site);
    return;
  }

  if (command === "sync") {
    if (!subcommand) await syncAll(parsed.adminUrl, parsed.projectRoot, parsed.site);
    else if (subcommand === "layouts") {
      await syncLayouts(parsed.adminUrl, parsed.projectRoot, parsed.site, {
        global: parsed.global,
        template: parsed.template,
      });
    }
    else if (subcommand === "assets") {
      await syncAssets(parsed.adminUrl, parsed.projectRoot, parsed.site, {
        global: parsed.global,
        template: parsed.template,
      });
    }
    else throw new Error(`Unknown sync target: ${subcommand}`);
    return;
  }

  if (command === "diff") {
    if (subcommand === "layouts") await diffLayouts(parsed.adminUrl, parsed.projectRoot, parsed.site);
    else throw new Error("diff requires target: layouts");
    return;
  }

  if (command === "migrate") {
    if (subcommand === "assets") await migrateAssets(parsed.adminUrl, parsed.projectRoot, parsed.site);
    else throw new Error("migrate requires target: assets");
    return;
  }

  if (command === "pull") {
    if (subcommand === "layouts") await pullLayouts(parsed.adminUrl, parsed.projectRoot, parsed.site);
    else throw new Error("pull requires target: layouts");
    return;
  }

  if (command === "site") {
    if (subcommand !== "create") throw new Error("site requires subcommand: create");
    await createSite(parsed.adminUrl, parseCreateSiteArgs(parsed.args.slice(2)));
    return;
  }

  if (command === "page") {
    const pageArgs = parsed.args.slice(2);
    if (subcommand === "list") await listPages(parsed.adminUrl, parsed.projectRoot, parsed.site);
    else if (subcommand === "create") await createPage(parsed.adminUrl, parsed.projectRoot, parsed.site, parsePageCreateArgs(pageArgs));
    else if (subcommand === "update") await updatePage(parsed.adminUrl, parsed.projectRoot, parsed.site, parsePageUpdateArgs(pageArgs));
    else if (subcommand === "delete") await deletePage(parsed.adminUrl, parsed.projectRoot, parsed.site, parsePageDeleteArgs(pageArgs).id);
    else throw new Error("page requires subcommand: list, create, update, or delete");
    return;
  }

  if (command === "forms") {
    const formArgs = parsed.args.slice(2);
    if (subcommand === "list") await listForms(parsed.adminUrl, parsed.projectRoot, parsed.site);
    else if (subcommand === "add") await addForm(parsed.adminUrl, parsed.projectRoot, parsed.site, parseFormArgs(formArgs).form);
    else if (subcommand === "remove") await removeForm(parsed.adminUrl, parsed.projectRoot, parsed.site, parseFormArgs(formArgs).form);
    else throw new Error("forms requires subcommand: list, add, or remove");
    return;
  }

  if (command === "build") {
    if (!subcommand) throw new Error("build requires a target.");
    await triggerBuild(parsed.adminUrl, subcommand, parsed.projectRoot, parsed.site);
    return;
  }

  if (command === "logout") {
    await logout(parsed.adminUrl, parsed.revoke);
    return;
  }

  console.log(usage());
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
