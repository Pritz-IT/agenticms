import { Bot, Check, Copy, Download, Terminal } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { DEFAULT_SITE_KEY } from "../site-routing";

export function normalizeAdminOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}

export function cliInstallCommand(adminOrigin: string): string {
  return `curl -fsSL ${adminOrigin}/api/cli/install.sh | sh`;
}

export function cliUsageCommands(adminOrigin: string, siteKey: string): string[] {
  return [
    `agenticms login ${adminOrigin}`,
    `agenticms status --site ${siteKey} --url ${adminOrigin}`,
    `agenticms sync layouts --site ${siteKey} --url ${adminOrigin}`,
    `agenticms sync assets --site ${siteKey} --url ${adminOrigin}`,
  ];
}

export function aiAgentInstructions(adminOrigin: string, siteKey: string): string {
  return [
    "You are working with AgentiCMS through the local CLI.",
    "",
    "Rules:",
    "1. Install the CLI from the admin panel if it is not installed.",
    `2. Authenticate with: agenticms login ${adminOrigin}`,
    `3. Check access before changing files: agenticms status --site ${siteKey} --url ${adminOrigin}`,
    `4. Inspect layout drift before edits: agenticms diff layouts --site ${siteKey} --url ${adminOrigin}`,
    `5. Sync layout changes only when the user asks: agenticms sync layouts --site ${siteKey} --url ${adminOrigin}`,
    `6. Sync assets only when needed: agenticms sync assets --site ${siteKey} --url ${adminOrigin}`,
    "7. Never trigger production builds or deploys without explicit user approval.",
    "8. Do not assume Git is the source of truth here; layout files and assets are the working surface.",
    "9. Prefer focused layout, CSS, and asset edits. Verify through the admin preview before syncing.",
  ].join("\n");
}

interface CommandBlockProps {
  command: string;
  label: string;
}

function CommandBlock({ command, label }: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</span>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-md border border-zinc-800 px-2 text-xs text-zinc-300 transition hover:border-cyan-500/40 hover:text-cyan-200"
          onClick={copyCommand}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 text-sm text-zinc-100">
        <code>{command}</code>
      </pre>
    </div>
  );
}

export function CliInstallPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const adminOrigin = useMemo(() => normalizeAdminOrigin(window.location.href), []);
  const installCommand = cliInstallCommand(adminOrigin);
  const usageCommands = cliUsageCommands(adminOrigin, siteKey);
  const agentInstructions = aiAgentInstructions(adminOrigin, siteKey);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="CLI" subtitle="Install and connect a local AgentiCMS operator" />

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-5">
          <section className="surface p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                <Download className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Install locally</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Downloads the admin-hosted CLI and starts the browser approval login.
                </p>
              </div>
            </div>
            <CommandBlock label="Install command" command={installCommand} />
          </section>

          <section className="surface p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300">
                <Terminal className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-100">Common commands</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Commands are scoped to the selected site: <span className="font-mono text-zinc-300">{siteKey}</span>.
                </p>
              </div>
            </div>
            <div className="grid gap-3">
              {usageCommands.map((command, index) => (
                <CommandBlock key={command} label={index === 0 ? "Login" : "Command"} command={command} />
              ))}
            </div>
          </section>

          <section className="surface p-5">
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-100">AI agent instruction</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Paste this into an AI coding session before it works on this AgentiCMS site.
                </p>
              </div>
            </div>
            <CommandBlock label="Agent prompt" command={agentInstructions} />
          </section>

          <a
            className="inline-flex w-fit items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300 transition hover:border-cyan-500/40 hover:text-cyan-200"
            href="/api/cli/agenticms-cli.tar.gz"
          >
            <Download className="h-4 w-4" />
            Download archive
          </a>
        </div>
      </div>
    </div>
  );
}
