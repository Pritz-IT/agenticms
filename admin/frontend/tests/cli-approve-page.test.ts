import { describe, expect, it } from "vitest";
import { formatOtp, initialApprovalCodeFromUrl } from "../src/pages/CliApprovePage";

describe("formatOtp", () => {
  it("keeps only the first six digits", () => {
    expect(formatOtp("12a 34-5678")).toBe("123456");
  });

  it("does not trust approval codes from URLs", () => {
    expect(initialApprovalCodeFromUrl(new URLSearchParams("code=123456"))).toBe("");
  });
});
