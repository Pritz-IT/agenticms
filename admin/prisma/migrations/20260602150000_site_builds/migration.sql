ALTER TABLE "builds" ADD COLUMN "site_id" TEXT;

UPDATE "builds"
SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo')
WHERE "site_id" IS NULL;

ALTER TABLE "builds" ALTER COLUMN "site_id" SET NOT NULL;

ALTER TABLE "builds"
ADD CONSTRAINT "builds_site_id_fkey"
FOREIGN KEY ("site_id") REFERENCES "sites"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "builds"
SET "files_deleted" = TRUE
WHERE "output_path" IS NOT NULL
  AND "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo')
  AND "output_path" NOT LIKE '%/demo/staging-%'
  AND "output_path" NOT LIKE '%/demo/production-%';
