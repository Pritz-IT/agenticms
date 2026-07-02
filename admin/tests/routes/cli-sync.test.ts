import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { access, mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { issueCliToken } from "../helpers/cli.js";

vi.mock("../../src/services/build.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/build.service.js")>()),
  triggerBuild: vi.fn().mockResolvedValue(undefined),
  triggerRollback: vi.fn().mockResolvedValue(undefined),
}));

let app: FastifyInstance;
let tempDir: string;
let layoutsDir: string;
let assetsDir: string;
let compiledLayoutsDir: string;
let cliToken: string;
let editorToken: string;
let demoSiteId: string;
let userCounter = 0;

function uniqueEmail(prefix: string): string {
  userCounter += 1;
  return `${prefix}-${userCounter}@example.com`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-cli-sync-"));
  layoutsDir = join(tempDir, "layouts");
  assetsDir = join(tempDir, "assets");
  compiledLayoutsDir = join(tempDir, "layout-modules");
  (config as { LAYOUTS_DIR: string; ASSETS_DIR: string; COMPILED_LAYOUTS_DIR: string }).LAYOUTS_DIR = layoutsDir;
  (config as { LAYOUTS_DIR: string; ASSETS_DIR: string; COMPILED_LAYOUTS_DIR: string }).ASSETS_DIR = assetsDir;
  (config as { LAYOUTS_DIR: string; ASSETS_DIR: string; COMPILED_LAYOUTS_DIR: string }).COMPILED_LAYOUTS_DIR = compiledLayoutsDir;
  await mkdir(layoutsDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(layoutsDir, { recursive: true, force: true });
  await rm(assetsDir, { recursive: true, force: true });
  await rm(compiledLayoutsDir, { recursive: true, force: true });
  await mkdir(layoutsDir, { recursive: true });
  await mkdir(assetsDir, { recursive: true });
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.globalLayoutTemplate.deleteMany();
  await app.prisma.asset.deleteMany();
  await app.prisma.globalAsset.deleteMany();
  await app.prisma.build.deleteMany();
  await app.prisma.cliToken.deleteMany();
  await app.prisma.cliDeviceChallenge.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const demoSite = await app.prisma.site.upsert({
    where: { key: "demo" },
    update: {
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
    create: {
      key: "demo",
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
  });

  const { user: editor } = await createTestUser(app, { role: "editor", email: uniqueEmail("editor") });
  editorToken = getAccessToken(editor);
  cliToken = await issueCliToken(app);
  demoSiteId = demoSite.id;
});

describe("CLI sync routes", () => {
  it("syncs a layout, stores a root-relative file path, and serves a preview module", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "Demo.tsx",
            content: `
              export const keys = { "hero.title": { type: "text", initial: "Hello" } };
              export default function Demo() { return <main>CLI Demo</main>; }
            `,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual([{ path: "Demo.tsx", status: "compiled" }]);

    const layout = await app.prisma.layout.findUnique({
      where: { siteId_filePath: { siteId: demoSiteId, filePath: "Demo.tsx" } },
    });
    expect(layout).toBeTruthy();

    const moduleRes = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout!.id}/module.js`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(moduleRes.statusCode).toBe(200);
    expect(moduleRes.body).toContain("CLI Demo");
  });

  it("syncs global layouts through the CLI endpoint", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/global-layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [{
          path: "sample-template/Home.tsx",
          content: `
            export const keys = { "hero.title": { type: "text", initial: "AI" } };
            export default function Home() { return <main>AI</main>; }
          `,
        }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().templates).toEqual([{ key: "sample-template/Home.tsx", status: "registered" }]);
  });

  it("syncs global assets through the CLI endpoint", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/global-assets",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [{
          path: "shared/brands/demo-brand/logo.svg",
          base64: Buffer.from("<svg />").toString("base64"),
        }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().assets).toEqual([
      expect.objectContaining({
        mode: "shared",
        filePath: "/assets/_global/shared/brands/demo-brand/logo.svg",
      }),
    ]);
  });

  it("rejects invalid global asset paths through the CLI endpoint", async () => {
    const traversalRes = await app.inject({
      method: "POST",
      url: "/api/cli/sync/global-assets",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [{
          path: "../escape.png",
          base64: Buffer.from("x").toString("base64"),
        }],
      },
    });
    expect(traversalRes.statusCode).toBe(400);

    const prefixRes = await app.inject({
      method: "POST",
      url: "/api/cli/sync/global-assets",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [{
          path: "other/hero.png",
          base64: Buffer.from("x").toString("base64"),
        }],
      },
    });
    expect(prefixRes.statusCode).toBe(400);
  });

  it("does not convert unexpected global asset sync failures to client errors", async () => {
    const upsertSpy = vi.spyOn(app.prisma.globalAsset, "upsert").mockRejectedValueOnce(new Error("database unavailable"));

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/cli/sync/global-assets",
        headers: { authorization: `Bearer ${cliToken}` },
        payload: {
          files: [{
            path: "shared/brands/demo-brand/logo.svg",
            base64: Buffer.from("<svg />").toString("base64"),
          }],
        },
      });

      expect(res.statusCode).toBe(500);
    } finally {
      upsertSpy.mockRestore();
    }
  });

  it("rejects traversal in layout and asset paths", async () => {
    const layoutRes = await app.inject({
      method: "POST",
      url: "/api/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { files: [{ path: "../escape.tsx", content: "export const keys = {};" }] },
    });
    expect(layoutRes.statusCode).toBe(400);

    const assetRes = await app.inject({
      method: "POST",
      url: "/api/cli/sync/assets",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { files: [{ path: "../escape.png", base64: Buffer.from("x").toString("base64") }] },
    });
    expect(assetRes.statusCode).toBe(400);
  });

  it("syncs a JavaScript ESM asset (e.g. vendored motion.js) and registers it as text/javascript", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/assets",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [{
          path: "motion.js",
          base64: Buffer.from("export const animate = () => {};").toString("base64"),
        }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual([{ path: "motion.js", status: "written" }]);

    // Self-hosted ESM modules must be served with a JS MIME type or the browser
    // refuses to execute <script type="module">. Before .js was added to the
    // MIME table the validator rejected the path and the watcher skipped it.
    const asset = await app.prisma.asset.findFirst({
      where: { siteId: demoSiteId, filePath: "/assets/demo/motion.js" },
    });
    expect(asset?.mimeType).toBe("text/javascript");
  });

  it("recompiles nested layouts after helper-only sync", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "demo/components/demo-token.ts",
            content: `export const DEMO_LABEL = "first helper";`,
          },
          {
            path: "demo/DemoHelper.tsx",
            content: `
              import { DEMO_LABEL } from "./components/demo-token";
              export const keys = { "hero.title": { type: "text", initial: "Hello" } };
              export default function DemoHelper() { return <main>{DEMO_LABEL}</main>; }
            `,
          },
        ],
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/api/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "demo/components/demo-token.ts",
            content: `export const DEMO_LABEL = "second helper";`,
          },
        ],
      },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().recompiled).toContain("demo/DemoHelper.tsx");

    const layout = await app.prisma.layout.findUnique({
      where: { siteId_filePath: { siteId: demoSiteId, filePath: "demo/DemoHelper.tsx" } },
    });
    const moduleRes = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout!.id}/module.js`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(moduleRes.statusCode).toBe(200);
    expect(moduleRes.body).toContain("second helper");
  });

  it("syncs supported assets and registers asset rows", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/assets",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [{ path: "demo.png", base64: Buffer.from("png").toString("base64") }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().assetSync.created).toBe(1);

    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    const asset = await app.prisma.asset.findFirst({ where: { filePath: "/assets/demo/demo.png" } });
    expect(asset).toMatchObject({ siteId: demo.id, filename: "demo.png", mimeType: "image/png" });
    await expect(fileExists(join(assetsDir, "demo", "demo.png"))).resolves.toBe(true);
  });

  it("exports layout source files for CLI diff and pull", async () => {
    await mkdir(join(layoutsDir, "demo", "components"), { recursive: true });
    await writeFile(join(layoutsDir, "demo", "ExportDemo.tsx"), "export default function ExportDemo() { return null; }\n");
    await writeFile(join(layoutsDir, "demo", "components", "tokens.ts"), "export const tone = 'calm';\n");
    await writeFile(join(layoutsDir, "demo", "notes.md"), "ignored");
    await mkdir(join(layoutsDir, "agenticms"), { recursive: true });
    await writeFile(join(layoutsDir, "agenticms", "AgentiCMSOnly.tsx"), "export default function AgentiCMSOnly() { return null; }\n");

    const res = await app.inject({
      method: "GET",
      url: "/api/cli/export/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().files).toEqual(
      expect.arrayContaining([
        {
          path: "ExportDemo.tsx",
          content: "export default function ExportDemo() { return null; }\n",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        {
          path: "components/tokens.ts",
          content: "export const tone = 'calm';\n",
          sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      ])
    );
    expect(res.json().files.some((file: { path: string }) => file.path === "notes.md")).toBe(false);
    expect(res.json().files.some((file: { path: string }) => file.path === "AgentiCMSOnly.tsx")).toBe(false);
  });

  it("removes stale demo layout source files that are no longer sent by the legacy CLI", async () => {
    await mkdir(join(layoutsDir, "demo"), { recursive: true });
    await writeFile(join(layoutsDir, "demo", "DemoHome.tsx"), "export const keys = {};\n");

    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "NewHome.tsx",
            content: `
              export const keys = { "hero.title": { type: "text", initial: "Nested" } };
              export default function DemoHome() { return <main>Nested</main>; }
            `,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(await fileExists(join(layoutsDir, "demo", "DemoHome.tsx"))).toBe(false);
    expect(await fileExists(join(layoutsDir, "demo", "NewHome.tsx"))).toBe(true);
  });

  it("does not prune non-demo layout files through legacy CLI sync", async () => {
    await mkdir(join(layoutsDir, "agenticms-cli-legacy"), { recursive: true });
    await writeFile(join(layoutsDir, "agenticms-cli-legacy", "AgentiCMSOnly.tsx"), "export const keys = {};\n");

    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "DemoOnly.tsx",
            content: `
              export const keys = { "hero.title": { type: "text", initial: "Demo" } };
              export default function DemoOnly() { return <main>Demo</main>; }
            `,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(await fileExists(join(layoutsDir, "demo", "DemoOnly.tsx"))).toBe(true);
    expect(await fileExists(join(layoutsDir, "agenticms-cli-legacy", "AgentiCMSOnly.tsx"))).toBe(true);
  });

  it("creates a CLI build and exposes status polling", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/cli/builds",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { target: "production" },
    });
    expect(create.statusCode).toBe(201);

    const status = await app.inject({
      method: "GET",
      url: `/api/cli/builds/${create.json().id}`,
      headers: { authorization: `Bearer ${cliToken}` },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ id: create.json().id, target: "production" });
  });

  it("coalesces duplicate default-site CLI builds for the same target", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/cli/builds",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { target: "production" },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/cli/builds",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { target: "production" },
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      id: first.json().id,
      target: "production",
      coalesced: true,
    });
  });

  it("reports status using only the default demo site", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms-cli-status",
        name: "AgentiCMS CLI Status",
        domain: "agenticms-cli-status.local",
        stagingDomain: "staging.agenticms-cli-status.local",
        defaultLocale: "en",
      },
    });
    await app.prisma.layout.create({ data: { siteId: demoSiteId, name: "Demo", filePath: "Demo.tsx", detectedKeys: {} } });
    await app.prisma.layout.create({ data: { siteId: agenticms.id, name: "AgentiCMS", filePath: "AgentiCMS.tsx", detectedKeys: {} } });
    await app.prisma.asset.create({ data: { siteId: demoSiteId, filename: "demo.png", mimeType: "image/png", filePath: "/assets/demo/demo.png", uploadedBy: "test" } });
    await app.prisma.asset.create({ data: { siteId: agenticms.id, filename: "agenticms.png", mimeType: "image/png", filePath: "/assets/agenticms/agenticms.png", uploadedBy: "test" } });
    await app.prisma.build.create({ data: { siteId: agenticms.id, target: "staging", status: "success", startedAt: new Date("2030-01-01") } });
    const demoBuild = await app.prisma.build.create({ data: { siteId: demoSiteId, target: "production", status: "pending", startedAt: new Date("2029-01-01") } });

    const res = await app.inject({
      method: "GET",
      url: "/api/cli/status",
      headers: { authorization: `Bearer ${cliToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      site: { key: "demo" },
      layouts: 1,
      assets: 1,
      latestBuild: { id: demoBuild.id, target: "production" },
    });
  });

  it("does not expose non-demo builds through the legacy CLI build lookup", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms-cli-build",
        name: "AgentiCMS CLI Build",
        domain: "agenticms-cli-build.local",
        stagingDomain: "staging.agenticms-cli-build.local",
        defaultLocale: "en",
      },
    });
    const build = await app.prisma.build.create({ data: { siteId: agenticms.id, target: "staging", status: "success" } });

    const res = await app.inject({
      method: "GET",
      url: `/api/cli/builds/${build.id}`,
      headers: { authorization: `Bearer ${cliToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("syncs layouts through the selected site-prefixed CLI route", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms-cli-sync",
        name: "AgentiCMS CLI Sync",
        domain: "agenticms-cli-sync.local",
        stagingDomain: "staging.agenticms-cli-sync.local",
        defaultLocale: "en",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/agenticms-cli-sync/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "Home.tsx",
            content: `
              export const keys = { "hero.title": { type: "text", initial: "AgentiCMS" } };
              export default function Home() { return <main>AgentiCMS</main>; }
            `,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(await fileExists(join(layoutsDir, "agenticms-cli-sync", "Home.tsx"))).toBe(true);
    await expect(
      app.prisma.layout.findUnique({
        where: { siteId_filePath: { siteId: agenticms.id, filePath: "Home.tsx" } },
      })
    ).resolves.toBeTruthy();
    await expect(
      app.prisma.layout.findUnique({
        where: { siteId_filePath: { siteId: demoSiteId, filePath: "Home.tsx" } },
      })
    ).resolves.toBeNull();
  });

  it("merges old site-prefixed layout rows during selected site CLI sync", async () => {
    const staleLayout = await app.prisma.layout.create({
      data: {
        siteId: demoSiteId,
        name: "DemoHome",
        filePath: "demo/DemoHome.tsx",
        detectedKeys: {},
      },
    });
    const page = await app.prisma.page.create({
      data: { siteId: demoSiteId, path: "/", layoutId: staleLayout.id },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/cli/sync/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: {
        files: [
          {
            path: "DemoHome.tsx",
            content: `
              export const keys = { "hero.title": { type: "text", initial: "Demo" } };
              export default function DemoHome() { return <main>Demo</main>; }
            `,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const canonical = await app.prisma.layout.findUnique({
      where: { siteId_filePath: { siteId: demoSiteId, filePath: "DemoHome.tsx" } },
    });
    const stale = await app.prisma.layout.findUnique({
      where: { siteId_filePath: { siteId: demoSiteId, filePath: "demo/DemoHome.tsx" } },
    });
    const updatedPage = await app.prisma.page.findUnique({ where: { id: page.id } });

    expect(canonical?.id).toBe(staleLayout.id);
    expect(stale).toBeNull();
    expect(updatedPage?.layoutId).toBe(canonical?.id);
  });

  it("exports layouts from the selected site-prefixed CLI route", async () => {
    await app.prisma.site.create({
      data: {
        key: "agenticms-cli-export",
        name: "AgentiCMS CLI Export",
        domain: "agenticms-cli-export.local",
        stagingDomain: "staging.agenticms-cli-export.local",
        defaultLocale: "en",
      },
    });
    await mkdir(join(layoutsDir, "agenticms-cli-export", "components"), { recursive: true });
    await writeFile(join(layoutsDir, "agenticms-cli-export", "ExportDemo.tsx"), "export default function ExportDemo() { return null; }\n");
    await writeFile(join(layoutsDir, "agenticms-cli-export", "components", "tokens.ts"), "export const tone = 'sharp';\n");
    await writeFile(join(layoutsDir, "DemoOnly.tsx"), "export default function DemoOnly() { return null; }\n");

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/agenticms-cli-export/cli/export/layouts",
      headers: { authorization: `Bearer ${cliToken}` },
    });

    expect(res.statusCode).toBe(200);
    const paths = res.json().files.map((file: { path: string }) => file.path);
    expect(paths).toEqual(expect.arrayContaining(["components/tokens.ts", "ExportDemo.tsx"]));
    expect(paths).not.toContain("DemoOnly.tsx");
  });

  it("reports status for the selected site-prefixed CLI route", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms-cli-selected-status",
        name: "AgentiCMS CLI Selected Status",
        domain: "agenticms-cli-selected-status.local",
        stagingDomain: "staging.agenticms-cli-selected-status.local",
        defaultLocale: "en",
      },
    });
    await app.prisma.layout.create({ data: { siteId: demoSiteId, name: "Demo", filePath: "Demo.tsx", detectedKeys: {} } });
    await app.prisma.layout.create({ data: { siteId: agenticms.id, name: "AgentiCMS", filePath: "AgentiCMS.tsx", detectedKeys: {} } });
    await app.prisma.asset.create({ data: { siteId: agenticms.id, filename: "agenticms.png", mimeType: "image/png", filePath: "/assets/agenticms-cli-selected-status/agenticms.png", uploadedBy: "test" } });
    const build = await app.prisma.build.create({ data: { siteId: agenticms.id, target: "staging", status: "success" } });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/agenticms-cli-selected-status/cli/status",
      headers: { authorization: `Bearer ${cliToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      site: { key: "agenticms-cli-selected-status" },
      layouts: 1,
      assets: 1,
      latestBuild: { id: build.id, target: "staging" },
    });
  });

  it("creates and polls builds through the selected site-prefixed CLI route", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms-cli-build-selected",
        name: "AgentiCMS CLI Build Selected",
        domain: "agenticms-cli-build-selected.local",
        stagingDomain: "staging.agenticms-cli-build-selected.local",
        defaultLocale: "en",
      },
    });

    const create = await app.inject({
      method: "POST",
      url: "/api/sites/agenticms-cli-build-selected/cli/builds",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { target: "staging" },
    });
    expect(create.statusCode).toBe(201);

    const row = await app.prisma.build.findUniqueOrThrow({ where: { id: create.json().id } });
    expect(row.siteId).toBe(agenticms.id);

    const poll = await app.inject({
      method: "GET",
      url: `/api/sites/agenticms-cli-build-selected/cli/builds/${create.json().id}`,
      headers: { authorization: `Bearer ${cliToken}` },
    });
    expect(poll.statusCode).toBe(200);
    expect(poll.json()).toMatchObject({ id: create.json().id, target: "staging" });
  });

  it("coalesces duplicate selected-site CLI builds for the same target", async () => {
    await app.prisma.site.create({
      data: {
        key: "agenticms-cli-build-coalesce",
        name: "AgentiCMS CLI Build Coalesce",
        domain: "agenticms-cli-build-coalesce.local",
        stagingDomain: "staging.agenticms-cli-build-coalesce.local",
        defaultLocale: "en",
      },
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/sites/agenticms-cli-build-coalesce/cli/builds",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { target: "staging" },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/sites/agenticms-cli-build-coalesce/cli/builds",
      headers: { authorization: `Bearer ${cliToken}` },
      payload: { target: "staging" },
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      id: first.json().id,
      target: "staging",
      coalesced: true,
    });
  });
});
