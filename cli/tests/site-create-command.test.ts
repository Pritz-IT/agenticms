import { describe, expect, it } from "vitest";
import { parseCreateSiteArgs } from "../src/sites";

describe("site create command", () => {
  it("parses the required site creation flags", () => {
    expect(
      parseCreateSiteArgs([
        "--key",
        "demo",
        "--name",
        "Demo Site",
        "--domain",
        "demo.example.com",
        "--staging-domain",
        "staging-demo.example.com",
        "--default-locale",
        "de",
        "--site-url",
        "https://demo.example.com",
      ])
    ).toEqual({
      key: "demo",
      name: "Demo Site",
      domain: "demo.example.com",
      stagingDomain: "staging-demo.example.com",
      defaultLocale: "de",
      siteUrl: "https://demo.example.com",
    });
  });

  it("rejects missing required flags before network access", () => {
    expect(() => parseCreateSiteArgs(["--key", "demo"])).toThrow("site create requires");
  });
});
