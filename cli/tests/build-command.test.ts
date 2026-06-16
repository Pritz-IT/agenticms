import { describe, it, expect } from "vitest";
import { triggerBuild } from "../src/build";

describe("build command", () => {
  it("rejects invalid build targets before network access", async () => {
    await expect(triggerBuild(undefined, "preview")).rejects.toThrow("Build target must be");
  });
});
