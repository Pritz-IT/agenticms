import path from "node:path";
import sharp from "sharp";

const CONVERTIBLE_MIME_TYPES = new Set(["image/png", "image/jpeg"]);
const MAX_INPUT_PIXELS = 40_000_000;

export interface AssetUploadInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface PreparedAssetUpload extends AssetUploadInput {
  converted: boolean;
}

function filenameWithWebpExtension(filename: string): string {
  const parsed = path.parse(filename);
  return `${parsed.name}.webp`;
}

export async function prepareAssetUpload(input: AssetUploadInput): Promise<PreparedAssetUpload> {
  if (!CONVERTIBLE_MIME_TYPES.has(input.mimeType)) {
    return { ...input, converted: false };
  }

  try {
    const buffer = await sharp(input.buffer, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .rotate()
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    return {
      filename: filenameWithWebpExtension(input.filename),
      mimeType: "image/webp",
      buffer,
      converted: true,
    };
  } catch (cause) {
    throw new Error("Invalid image upload", { cause });
  }
}
