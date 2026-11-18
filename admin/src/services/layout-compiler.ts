import { createHash } from "crypto";
import { build, type Message } from "esbuild";
import { readFile } from "fs/promises";
import { dirname, join, resolve } from "path";

export interface CompileErrorLocation {
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
}

export interface CompileLayoutError {
  text: string;
  location?: CompileErrorLocation;
}

export type CompileLayoutResult =
  | { ok: true; code: string; inputs: string[]; inputHash: string }
  | { ok: false; errors: CompileLayoutError[] };

function toCompileError(message: Message): CompileLayoutError {
  return {
    text: message.text,
    location: message.location
      ? {
          file: message.location.file,
          line: message.location.line,
          column: message.location.column,
          lineText: message.location.lineText,
        }
      : undefined,
  };
}

function unknownErrorToCompileError(err: unknown): CompileLayoutError {
  return { text: err instanceof Error ? err.message : String(err) };
}

export async function computeInputHash(inputs: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const input of [...inputs].sort()) {
    hash.update(input);
    hash.update("\0");
    hash.update(await readFile(input));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function sameInputs(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

export type CompileMode = "browser" | "server";
const SERVER_ENTRY = "<preview-entry>";

// "browser": the visual editor module; React and the components stay external so
// the SPA's live singletons are shared. "server": a self-contained Node bundle for
// the blog post preview, resolved against the website project (its React, its
// components, its document head) so it renders exactly what the static build does.
function serverBuildOptions(absLayoutPath: string, astroProjectDir: string) {
  const entry = [
    `export { default as Layout } from ${JSON.stringify(absLayoutPath)};`,
    `export { createElement } from "react";`,
    `export { renderToString } from "react-dom/server";`,
    `export { documentHeadHtml } from ${JSON.stringify(join(astroProjectDir, "src/lib/document-head.ts"))};`,
  ].join("\n");
  return {
    stdin: { contents: entry, resolveDir: dirname(absLayoutPath), sourcefile: SERVER_ENTRY, loader: "ts" as const },
    platform: "node" as const,
    target: "node20",
    nodePaths: [join(astroProjectDir, "node_modules")],
    alias: { "@agenticms/components": join(astroProjectDir, "src/components/index.ts") },
    // react-dom/server requires Node built-ins; an ESM bundle needs a real require.
    banner: { js: "import{createRequire}from'module';const require=createRequire(import.meta.url);" },
  };
}

async function buildLayout(absLayoutPath: string, mode: CompileMode, astroProjectDir: string): Promise<{ code: string; inputs: string[] }> {
  const result = await build({
    bundle: true,
    format: "esm",
    write: false,
    jsx: "automatic",
    metafile: true,
    logLevel: "silent",
    ...(mode === "server"
      ? serverBuildOptions(absLayoutPath, astroProjectDir)
      : {
          entryPoints: [absLayoutPath],
          platform: "browser" as const,
          target: "es2020",
          external: [
            "react",
            "react-dom",
            "react-dom/client",
            "react/jsx-runtime",
            "@agenticms/components",
          ],
        }),
  });

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error("Layout compile produced no output");
  }

  return {
    code: output,
    // ponytail: in server mode React lives in the website's node_modules, which only
    // change with an image rebuild (= restart), so they stay out of the input hash.
    inputs: Object.keys(result.metafile?.inputs ?? {})
      .filter((input) => !input.endsWith(SERVER_ENTRY) && !(mode === "server" && input.includes("node_modules/")))
      .map((input) => resolve(process.cwd(), input)),
  };
}

export async function compileLayout(absLayoutPath: string, mode: CompileMode = "browser", astroProjectDir = ""): Promise<CompileLayoutResult> {
  try {
    let previousInputs: string[] | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeInputs = previousInputs;
      const beforeHash = beforeInputs ? await computeInputHash(beforeInputs) : null;
      const built = await buildLayout(absLayoutPath, mode, astroProjectDir);
      if (beforeInputs && !sameInputs(beforeInputs, built.inputs)) {
        previousInputs = built.inputs;
        continue;
      }
      const afterHash = await computeInputHash(built.inputs);
      if (!beforeInputs) {
        previousInputs = built.inputs;
        continue;
      }
      if (beforeHash === afterHash) {
        return { ok: true, code: built.code, inputs: built.inputs, inputHash: afterHash };
      }
      previousInputs = built.inputs;
    }

    return { ok: false, errors: [{ text: "Layout inputs changed while compiling; retry preview" }] };
  } catch (err) {
    const maybeErrors = (err as { errors?: Message[] }).errors;
    return {
      ok: false,
      errors: Array.isArray(maybeErrors) && maybeErrors.length > 0
        ? maybeErrors.map(toCompileError)
        : [unknownErrorToCompileError(err)],
    };
  }
}
