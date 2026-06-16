import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareLayoutFiles, pullLayoutFiles, type RemoteLayoutFile } from "../src/layout-pull";

describe("layout pull and diff", () => {
  it("compares remote layouts to local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-pull-"));
    const layoutsRoot = join(root, ".agenticms", "layouts", "demo");
    await mkdir(join(layoutsRoot, "components"), { recursive: true });
    await writeFile(join(layoutsRoot, "Same.tsx"), "same");
    await writeFile(join(layoutsRoot, "Changed.tsx"), "local");
    await writeFile(join(layoutsRoot, "LocalOnly.tsx"), "local-only");

    const remote: RemoteLayoutFile[] = [
      { path: "Changed.tsx", content: "remote", sha256: "" },
      { path: "Missing.tsx", content: "missing", sha256: "" },
      { path: "Same.tsx", content: "same", sha256: "" },
    ];

    const diff = await compareLayoutFiles(layoutsRoot, remote);

    expect(diff).toEqual([
      { path: "Changed.tsx", status: "changed" },
      { path: "LocalOnly.tsx", status: "local-only" },
      { path: "Missing.tsx", status: "missing-local" },
      { path: "Same.tsx", status: "same" },
    ]);
  });

  it("pulls remote layouts and backs up overwritten local files", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-pull-"));
    const layoutsRoot = join(root, ".agenticms", "layouts", "demo");
    await mkdir(layoutsRoot, { recursive: true });
    await writeFile(join(layoutsRoot, "Changed.tsx"), "local");

    const result = await pullLayoutFiles(
      layoutsRoot,
      [
        { path: "Changed.tsx", content: "remote", sha256: "" },
        { path: "Fresh.tsx", content: "fresh", sha256: "" },
      ],
      { timestamp: "2026-06-01T060000000Z" }
    );

    expect(result.files).toEqual([
      { path: "Changed.tsx", status: "updated" },
      { path: "Fresh.tsx", status: "created" },
    ]);
    expect(await readFile(join(layoutsRoot, "Changed.tsx"), "utf-8")).toBe("remote");
    expect(await readFile(join(layoutsRoot, "Fresh.tsx"), "utf-8")).toBe("fresh");
    expect(
      await readFile(
        join(root, ".agenticms", ".backups", "layouts", "demo", "2026-06-01T060000000Z", "Changed.tsx"),
        "utf-8"
      )
    ).toBe("local");
  });

  it("does not create a backup for unchanged files", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-pull-"));
    const layoutsRoot = join(root, ".agenticms", "layouts", "demo");
    await mkdir(layoutsRoot, { recursive: true });
    await writeFile(join(layoutsRoot, "Same.tsx"), "same");

    const result = await pullLayoutFiles(
      layoutsRoot,
      [{ path: "Same.tsx", content: "same", sha256: "" }],
      { timestamp: "2026-06-01T060000000Z" }
    );

    expect(result.files).toEqual([{ path: "Same.tsx", status: "same" }]);
    await expect(stat(join(root, ".agenticms", ".backups", "layouts", "demo", "2026-06-01T060000000Z"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses exported paths that would escape the local layouts directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-pull-"));
    const layoutsRoot = join(root, ".agenticms", "layouts", "demo");

    await expect(
      pullLayoutFiles(layoutsRoot, [{ path: "../escape.tsx", content: "bad", sha256: "" }], {
        timestamp: "2026-06-01T060000000Z",
      })
    ).rejects.toThrow(/invalid path segment/);
  });
});
