import path from "path";

export interface LayoutKey {
  type: "text" | "richtext" | "image" | "link" | "page" | "navigation";
  initial: string;
}

export type LayoutKeys = Record<string, LayoutKey>;

const VALID_TYPES = new Set(["text", "richtext", "image", "link", "page", "navigation"]);

/**
 * Extract the `export const keys = { ... };` block from file content and parse
 * each entry into a LayoutKeys map. Uses static regex — no runtime import.
 */
export function parseLayoutKeys(fileContent: string): LayoutKeys {
  // Match the entire keys object body (handles multi-line).
  // The outer regex uses [\s\S]*? (non-greedy) to stop at the first };
  // which is correct for a well-formed single-level object literal.
  const blockMatch = fileContent.match(
    /export\s+const\s+keys\s*=\s*\{([\s\S]*?)\};/
  );
  if (!blockMatch || !blockMatch[1]) return {};

  const block = blockMatch[1];
  const result: LayoutKeys = {};

  // Match each entry: "key.name": { type: "...", initial: "..." }
  // Supports single and double quotes for both key and values.
  // Backreferences (\1, \3, \5) enforce that opening and closing quotes match —
  // e.g. "foo" is valid but "foo' is not.
  const entryRegex =
    /(['"])([\w._-]+)\1\s*:\s*\{\s*type\s*:\s*(['"])([\w]+)\3\s*,\s*initial\s*:\s*(['"])((?:[^'"\\]|\\.)*)\5/g;

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(block)) !== null) {
    const keyName = match[2]!;
    const typeName = match[4]!;
    const initialValue = match[6]!;

    if (!VALID_TYPES.has(typeName)) continue;

    result[keyName] = {
      type: typeName as LayoutKey["type"],
      initial: initialValue,
    };
  }

  return result;
}

/**
 * Extract the filename without extension from a file path.
 */
export function extractLayoutName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}
