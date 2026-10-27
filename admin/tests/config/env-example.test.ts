import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const disallowedSecretPlaceholders = [
  "your-super-secret-jwt-key-change-in-production",
  "your-internal-api-key-change-in-production",
];

const secretKeys = ["POSTGRES_PASSWORD", "JWT_SECRET", "INTERNAL_API_KEY", "ADMIN_PASSWORD"];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function parseEnvAssignments(contents: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

describe("env examples", () => {
  it("documents post media storage and keeps dev uploads in the state directory", async () => {
    const example = await readFile(path.join(repoRoot, "admin/.env.example"), "utf8");
    expect(parseEnvAssignments(example).get("POST_MEDIA_DIR")).toBe("./post-media");
    const dev = await readFile(path.join(repoRoot, "scripts/dev.sh"), "utf8");
    expect(dev).toContain('POST_MEDIA_DIR="$STATE_DIR/post-media"');
    expect(dev).toMatch(/mkdir -p[^\n]*"\$POST_MEDIA_DIR"/);
    expect(dev).toContain('POST_MEDIA_DIR="$POST_MEDIA_DIR"');
  });

  it("do not ship known secret placeholder values", async () => {
    const envExamplePaths = [
      path.join(repoRoot, ".env.example"),
      path.join(repoRoot, "admin", ".env.example"),
    ];

    const envExamples = await Promise.all(
      envExamplePaths.map(async (envExamplePath) => ({
        path: envExamplePath,
        contents: await readFile(envExamplePath, "utf8"),
      })),
    );

    for (const envExample of envExamples) {
      for (const placeholder of disallowedSecretPlaceholders) {
        expect(envExample.contents, `${envExample.path} contains ${placeholder}`).not.toContain(placeholder);
      }
    }
  });

  it("keeps tracked example secret values empty", async () => {
    const envExamplePaths = [
      path.join(repoRoot, ".env.example"),
      path.join(repoRoot, "admin", ".env.example"),
    ];

    for (const envExamplePath of envExamplePaths) {
      const values = parseEnvAssignments(await readFile(envExamplePath, "utf8"));
      for (const key of secretKeys) {
        if (values.has(key)) {
          expect(values.get(key), `${envExamplePath} must not set ${key}`).toBe("");
        }
      }
    }
  });
});
