-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "allowed_forms" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill each site from the forms it has ACTUALLY received (no hardcoded
-- names). Filter to the SAME slug predicate the public schema now enforces so
-- legacy/junk form values are not imported into the allowlist.
UPDATE "sites" s
SET "allowed_forms" = sub.forms
FROM (
  SELECT "site_id", array_agg(DISTINCT "form") AS forms
  FROM "submissions"
  WHERE "form" ~ '^[a-z0-9-]+$' AND length("form") <= 64
  GROUP BY "site_id"
) sub
WHERE s.id = sub."site_id";
