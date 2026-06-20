import { describe, expect, it } from "vitest";
import {
  aiAgentInstructions,
  cliInstallCommand,
  cliUsageCommands,
  normalizeAdminOrigin,
} from "../src/pages/CliInstallPage";

describe("CLI install page helpers", () => {
  it("normalizes the current admin origin for copyable commands", () => {
    expect(normalizeAdminOrigin("http://localhost:5174/sites/demo/cli")).toBe("http://localhost:5174");
    expect(normalizeAdminOrigin("https://cms.example.com/sites/demo/cli")).toBe("https://cms.example.com");
  });

  it("creates an install command that downloads the admin-hosted installer", () => {
    expect(cliInstallCommand("https://cms.example.com")).toBe(
      "curl -fsSL https://cms.example.com/api/cli/install.sh | sh"
    );
  });

  it("shows the local auth and site-scoped status commands", () => {
    expect(cliUsageCommands("http://localhost:3001", "demo")).toEqual([
      "agenticms login http://localhost:3001",
      "agenticms status --site demo --url http://localhost:3001",
      "agenticms diff layouts --site demo --url http://localhost:3001",
      "agenticms sync layouts --site demo --url http://localhost:3001",
      "agenticms sync assets --site demo --url http://localhost:3001",
    ]);
  });

  it("creates a copyable AI agent instruction with safety rules and site commands", () => {
    const instructions = aiAgentInstructions("https://cms.example.com", "demo");
    const oldBrand = ["Site", "Forge"].join("");
    const oldCommand = ["site", "forge"].join("");

    expect(instructions).toContain("You are working with AgentiCMS through the local CLI.");
    expect(instructions).toContain("agenticms login https://cms.example.com");
    expect(instructions).toContain("agenticms status --site demo --url https://cms.example.com");
    expect(instructions).toContain("agenticms diff layouts --site demo --url https://cms.example.com");
    expect(instructions).toContain("agenticms sync layouts --site demo --url https://cms.example.com");
    expect(instructions).toContain("Never trigger production builds or deploys without explicit user approval.");
    expect(instructions).not.toContain(oldBrand);
    expect(instructions).not.toContain(oldCommand);
  });
});
