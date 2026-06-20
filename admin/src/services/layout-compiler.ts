import { createHash } from "crypto";
import { build, type Message } from "esbuild";
import { readFile } from "fs/promises";
import { resolve } from "path";

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

async function computeInputHash(inputs: string[]): Promise<string> {
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

async function buildLayout(absLayoutPath: string): Promise<{ code: string; inputs: string[] }> {
  const result = await build({
    entryPoints: [absLayoutPath],
    bundle: true,
    format: "esm",
    write: false,
    jsx: "automatic",
    platform: "browser",
    target: "es2020",
    metafile: true,
    logLevel: "silent",
    external: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@agenticms/components",
    ],
  });

  const output = result.outputFiles?.[0]?.text;
  if (!output) {
    throw new Error("Layout compile produced no output");
  }

  return {
    code: output,
    inputs: Object.keys(result.metafile?.inputs ?? {}).map((input) =>
      resolve(process.cwd(), input)
    ),
  };
}

export async function compileLayout(absLayoutPath: string): Promise<CompileLayoutResult> {
  try {
    let previousInputs: string[] | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const beforeInputs = previousInputs;
      const beforeHash = beforeInputs ? await computeInputHash(beforeInputs) : null;
      const built = await buildLayout(absLayoutPath);
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
