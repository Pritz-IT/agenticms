import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, realpath, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { compileLayout } from "../../src/services/layout-compiler.js";
import { LayoutModuleCache } from "../../src/services/layout-module-cache.js";

async function fixtureDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "sf-layout-compiler-"));
}

describe("compileLayout", () => {
  it("compiles valid TSX to ESM while keeping React and agenticms imports external", async () => {
    const dir = await fixtureDir();
    const file = join(dir, "Home.tsx");
    await writeFile(file, `
      import { RichText } from "@agenticms/components";
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Home({ content }: { content: Record<string, string> }) {
        return <main><RichText value={content["hero.title"]} /></main>;
      }
    `);

    const result = await compileLayout(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected compile success");
    expect(result.code).toContain("import");
    expect(result.code).toContain("react/jsx-runtime");
    expect(result.code).toContain("@agenticms/components");
    expect(result.code).not.toContain("function useState");
    expect(result.inputs).toContain(await realpath(file));
    await expect(new LayoutModuleCache(join(dir, ".cache")).computeInputHash(result.inputs))
      .resolves.toBe(result.inputHash);
  });

  it("bundles relative sibling components and reports them as inputs", async () => {
    const dir = await fixtureDir();
    await mkdir(join(dir, "components"));
    const file = join(dir, "Home.tsx");
    const sibling = join(dir, "components", "Hero.tsx");
    await writeFile(sibling, `
      export function Hero({ title }: { title: string }) {
        return <h1>{title}</h1>;
      }
    `);
    await writeFile(file, `
      import { Hero } from "./components/Hero";
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Home({ content }: { content: Record<string, string> }) {
        return <Hero title={content["hero.title"]} />;
      }
    `);

    const result = await compileLayout(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected compile success");
    expect(result.code).toContain("function Hero");
    expect(result.inputs).toContain(await realpath(file));
    expect(result.inputs).toContain(await realpath(sibling));
  });

  it("returns structured errors for broken TSX instead of throwing", async () => {
    const dir = await fixtureDir();
    const file = join(dir, "Broken.tsx");
    await writeFile(file, `
      export default function Broken() {
        return <main>
      }
    `);

    const result = await compileLayout(file);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected compile failure");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].text.length).toBeGreaterThan(0);
  });
});
