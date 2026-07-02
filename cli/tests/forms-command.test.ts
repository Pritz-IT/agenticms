import { describe, it, expect } from "vitest";
import { parseFormArgs } from "../src/forms.js";

describe("parseFormArgs", () => {
  it("parses --form", () => expect(parseFormArgs(["--form", "contact"])).toEqual({ form: "contact" }));
  it("throws without --form", () => expect(() => parseFormArgs([])).toThrow(/requires --form/));
  it("throws on unknown option", () => expect(() => parseFormArgs(["--nope", "x"])).toThrow(/Unknown/));
});
