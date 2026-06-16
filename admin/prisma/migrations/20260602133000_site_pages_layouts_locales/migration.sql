-- Ensure the pre-existing single-tenant data has a default site to attach to.
INSERT INTO "sites" (
    "id",
    "key",
    "name",
    "domain",
    "staging_domain",
    "default_locale",
    "site_url",
    "created_at",
    "updated_at"
)
SELECT
    'demo',
    'demo',
    COALESCE((SELECT "name" FROM "settings" LIMIT 1), 'Demo Site'),
    COALESCE((SELECT "domain" FROM "settings" LIMIT 1), 'example.com'),
    COALESCE((SELECT "staging_domain" FROM "settings" LIMIT 1), 'staging.example.com'),
    COALESCE((SELECT "default_locale" FROM "settings" LIMIT 1), 'de'),
    (SELECT "site_url" FROM "settings" LIMIT 1),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "sites" WHERE "key" = 'demo');

ALTER TABLE "locales" ADD COLUMN "site_id" TEXT;
ALTER TABLE "layouts" ADD COLUMN "site_id" TEXT;
ALTER TABLE "pages" ADD COLUMN "site_id" TEXT;

UPDATE "locales" SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo');
UPDATE "layouts" SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo');
UPDATE "pages" SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo');

ALTER TABLE "locales" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "layouts" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "pages" ALTER COLUMN "site_id" SET NOT NULL;

ALTER TABLE "locales" ADD CONSTRAINT "locales_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "layouts" ADD CONSTRAINT "layouts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX IF EXISTS "locales_code_key";
DROP INDEX IF EXISTS "layouts_file_path_key";
DROP INDEX IF EXISTS "pages_path_key";

CREATE UNIQUE INDEX "locales_site_id_code_key" ON "locales"("site_id", "code");
CREATE UNIQUE INDEX "layouts_site_id_file_path_key" ON "layouts"("site_id", "file_path");
CREATE UNIQUE INDEX "pages_site_id_path_key" ON "pages"("site_id", "path");
