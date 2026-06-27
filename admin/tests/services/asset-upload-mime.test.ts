import { describe, it, expect } from "vitest";
import { resolveUploadMime } from "../../src/services/asset-watcher.js";

describe("resolveUploadMime", () => {
  it("accepts raster images and derives the canonical MIME from the extension", () => {
    expect(resolveUploadMime("logo.png")).toBe("image/png");
    expect(resolveUploadMime("photo.JPG")).toBe("image/jpeg"); // case-insensitive
    expect(resolveUploadMime("anim.gif")).toBe("image/gif");
    expect(resolveUploadMime("pic.webp")).toBe("image/webp");
    expect(resolveUploadMime("hero.avif")).toBe("image/avif");
  });

  it("accepts pdf and fonts", () => {
    expect(resolveUploadMime("doc.pdf")).toBe("application/pdf");
    expect(resolveUploadMime("font.woff2")).toBe("font/woff2");
    expect(resolveUploadMime("font.ttf")).toBe("font/ttf");
  });

  it("accepts self-hosted video", () => {
    expect(resolveUploadMime("hero-video.mp4")).toBe("video/mp4");
    expect(resolveUploadMime("CLIP.MP4")).toBe("video/mp4"); // case-insensitive
    expect(resolveUploadMime("hero.webm")).toBe("video/webm");
  });

  it("rejects executable/active types that could run same-origin", () => {
    expect(resolveUploadMime("evil.js")).toBeNull();
    expect(resolveUploadMime("evil.mjs")).toBeNull();
    expect(resolveUploadMime("data.json")).toBeNull();
    expect(resolveUploadMime("page.html")).toBeNull();
    expect(resolveUploadMime("page.htm")).toBeNull();
  });

  it("rejects unknown / extensionless files", () => {
    expect(resolveUploadMime("archive.zip")).toBeNull();
    expect(resolveUploadMime("noext")).toBeNull();
    expect(resolveUploadMime("backup.tar.gz")).toBeNull();
  });

  it("does not trust a double extension — only the final extension counts", () => {
    // `evil.png.js` resolves to .js → denied (cannot disguise a script as a png)
    expect(resolveUploadMime("evil.png.js")).toBeNull();
  });
});
