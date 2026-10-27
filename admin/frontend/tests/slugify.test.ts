import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { slugify } from "../src/lib/slugify";

describe("slugify", () => {
  it("transliterates German before stripping other diacritics", () => {
    assert.equal(
      slugify("Schulbus-Routen für Gemeinden: ein Überblick"),
      "schulbus-routen-fuer-gemeinden-ein-ueberblick"
    );
    assert.equal(slugify("ÄÖÜ Straße École déjà vu"), "aeoeue-strasse-ecole-deja-vu");
    assert.equal(slugify("A\u0308pfel & Öl!"), "aepfel-oel");
  });
  it("trims separators and handles empty titles", () => {
    assert.equal(slugify("  "), "");
    assert.equal(slugify(" -- Hello__WORLD 123! "), "hello-world-123");
  });
});
