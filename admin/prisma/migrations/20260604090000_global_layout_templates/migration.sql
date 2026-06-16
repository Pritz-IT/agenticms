CREATE TABLE "global_layout_templates" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "detected_keys" JSONB NOT NULL DEFAULT '{}',
  "source_hash" TEXT NOT NULL,
  "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "global_layout_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "global_layout_templates_key_key" ON "global_layout_templates"("key");
CREATE UNIQUE INDEX "global_layout_templates_file_path_key" ON "global_layout_templates"("file_path");

ALTER TABLE "layouts" ADD COLUMN "global_template_id" TEXT;
ALTER TABLE "layouts" ADD COLUMN "global_template_hash" TEXT;

ALTER TABLE "layouts"
  ADD CONSTRAINT "layouts_global_template_id_fkey"
  FOREIGN KEY ("global_template_id")
  REFERENCES "global_layout_templates"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
