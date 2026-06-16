import {
  describe, it, expect, beforeAll, afterAll, vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { promises as fs } from "fs";
import path from "path";

let app: FastifyInstance;

// A serving dir and a SIBLING dir whose name shares the serving dir as a
// string prefix. A naive `fullPath.startsWith(assetsDir)` boundary check
// treats "/x/leak-assets-secret" as inside "/x/leak-assets".
const SERVE_DIR = path.resolve("./leak-assets");
const SIBLING_DIR = path.resolve("./leak-assets-secret");
const SECRET_NAME = "secret.txt";

const savedAssetsDir = process.env["ASSETS_DIR"];

beforeAll(async () => {
  await fs.mkdir(SERVE_DIR, { recursive: true });
  await fs.mkdir(SIBLING_DIR, { recursive: true });
  await fs.writeFile(path.join(SIBLING_DIR, SECRET_NAME), "TOP SECRET");

  process.env["ASSETS_DIR"] = "./leak-assets";
  vi.resetModules(); // re-read config.ASSETS_DIR
  const mod = await import("../../src/app.js");
  app = await mod.buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await fs.rm(SERVE_DIR, { recursive: true, force: true });
  await fs.rm(SIBLING_DIR, { recursive: true, force: true });
  if (savedAssetsDir === undefined) delete process.env["ASSETS_DIR"];
  else process.env["ASSETS_DIR"] = savedAssetsDir;
  vi.resetModules();
});

describe("GET /assets/* path boundary", () => {
  it("does not serve a file from a sibling dir that shares the name prefix", async () => {
    const res = await app.inject({
      method: "GET",
      // params["*"] -> "../leak-assets-secret/secret.txt"
      url: `/assets/..%2Fleak-assets-secret%2F${SECRET_NAME}`,
    });

    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain("TOP SECRET");
  });
});
