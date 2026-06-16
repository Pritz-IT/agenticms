import { createHash } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { join } from "path";

export interface LayoutModuleCacheEntry {
  code: string;
  inputHash: string;
  inputs: string[];
}

interface Sidecar {
  inputHash: string;
  inputs: string[];
  codeHash: string;
}

export class LayoutModuleCache {
  constructor(private readonly rootDir: string) {}

  async computeInputHash(inputs: string[]): Promise<string> {
    const hash = createHash("sha256");
    for (const input of [...inputs].sort()) {
      hash.update(input);
      hash.update("\0");
      hash.update(await readFile(input));
      hash.update("\0");
    }
    return hash.digest("hex");
  }

  async get(layoutId: string): Promise<LayoutModuleCacheEntry | null> {
    this.validateLayoutId(layoutId);

    try {
      const sidecar = JSON.parse(await readFile(this.sidecarPath(layoutId), "utf-8")) as Sidecar;
      const currentHash = await this.computeInputHash(sidecar.inputs);
      if (currentHash !== sidecar.inputHash) return null;
      const code = await readFile(this.modulePath(layoutId), "utf-8");
      if (this.computeStringHash(code) !== sidecar.codeHash) return null;
      return { code, inputHash: sidecar.inputHash, inputs: sidecar.inputs };
    } catch (_err) {
      return null;
    }
  }

  async set(layoutId: string, inputHash: string, code: string, inputs: string[]): Promise<void> {
    this.validateLayoutId(layoutId);
    await mkdir(this.rootDir, { recursive: true });
    const modulePath = this.modulePath(layoutId);
    const sidecarPath = this.sidecarPath(layoutId);
    const moduleTmp = this.tempPath(layoutId, "mjs");
    const sidecarTmp = this.tempPath(layoutId, "json");
    const sidecar: Sidecar = { inputHash, inputs, codeHash: this.computeStringHash(code) };

    await writeFile(moduleTmp, code, "utf-8");
    await writeFile(sidecarTmp, JSON.stringify(sidecar, null, 2), "utf-8");
    await rename(moduleTmp, modulePath);
    await rename(sidecarTmp, sidecarPath);
  }

  async evict(layoutId: string): Promise<void> {
    this.validateLayoutId(layoutId);
    await Promise.all([
      rm(this.modulePath(layoutId), { force: true }),
      rm(this.sidecarPath(layoutId), { force: true }),
    ]);
  }

  async getLastGood(layoutId: string): Promise<string | null> {
    this.validateLayoutId(layoutId);
    try {
      const sidecar = JSON.parse(await readFile(this.sidecarPath(layoutId), "utf-8")) as Sidecar;
      const code = await readFile(this.modulePath(layoutId), "utf-8");
      return this.computeStringHash(code) === sidecar.codeHash ? code : null;
    } catch (_err) {
      return null;
    }
  }

  private modulePath(layoutId: string): string {
    return join(this.rootDir, `${layoutId}.mjs`);
  }

  private sidecarPath(layoutId: string): string {
    return join(this.rootDir, `${layoutId}.json`);
  }

  private tempPath(layoutId: string, extension: string): string {
    return join(this.rootDir, `${layoutId}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.${extension}.tmp`);
  }

  private validateLayoutId(layoutId: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(layoutId)) {
      throw new Error(`Invalid layout id for cache path: ${layoutId}`);
    }
  }

  private computeStringHash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
}
