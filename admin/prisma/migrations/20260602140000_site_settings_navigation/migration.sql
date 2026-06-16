-- Ensure there is a default site for pre-existing single-tenant rows.
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

ALTER TABLE "navigation" ADD COLUMN "site_id" TEXT;
ALTER TABLE "staging_access" ADD COLUMN "site_id" TEXT;

UPDATE "navigation" SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo') WHERE "site_id" IS NULL;
UPDATE "staging_access" SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo') WHERE "site_id" IS NULL;

ALTER TABLE "navigation" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "staging_access" ALTER COLUMN "site_id" SET NOT NULL;

ALTER TABLE "navigation" ADD CONSTRAINT "navigation_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staging_access" ADD CONSTRAINT "staging_access_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE IF EXISTS "settings";
