CREATE TYPE "GlobalAssetMode" AS ENUM ('shared', 'copyable');

CREATE TABLE "global_assets" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "mode" "GlobalAssetMode" NOT NULL,
  "template_folder" TEXT,
  "filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "source_hash" TEXT NOT NULL,
  "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "global_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_assets_key_key" ON "global_assets"("key");
CREATE UNIQUE INDEX "global_assets_file_path_key" ON "global_assets"("file_path");
CREATE INDEX "global_assets_mode_idx" ON "global_assets"("mode");
CREATE INDEX "global_assets_template_folder_idx" ON "global_assets"("template_folder");

ALTER TABLE "assets" ADD COLUMN "global_asset_id" TEXT;
ALTER TABLE "assets" ADD COLUMN "global_asset_hash" TEXT;
CREATE INDEX "assets_global_asset_id_idx" ON "assets"("global_asset_id");

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_global_asset_id_fkey"
  FOREIGN KEY ("global_asset_id")
  REFERENCES "global_assets"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
