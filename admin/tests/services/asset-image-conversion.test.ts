import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareAssetUpload } from "../../src/services/asset-image-conversion.js";

let tinyPng: Buffer;

beforeAll(async () => {
  tinyPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 4,
      background: { r: 0, g: 128, b: 255, alpha: 1 },
    },
  }).png().toBuffer();
});

describe("prepareAssetUpload", () => {
  it("converts PNG uploads to WebP and rewrites the stored filename", async () => {
    const result = await prepareAssetUpload({
      filename: "Hero Image.PNG",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    expect(result.filename).toBe("Hero Image.webp");
    expect(result.mimeType).toBe("image/webp");
    expect(result.converted).toBe(true);
    expect(result.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  });

  it("leaves already optimized or non-raster uploads unchanged", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

    const result = await prepareAssetUpload({
      filename: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: svg,
    });

    expect(result).toEqual({
      filename: "logo.svg",
      mimeType: "image/svg+xml",
      buffer: svg,
      converted: false,
    });
  });

  it("rejects invalid raster bytes instead of storing spoofed image files", async () => {
    await expect(
      prepareAssetUpload({
        filename: "not-a-real-image.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      }),
    ).rejects.toThrow("Invalid image upload");
  });
});
