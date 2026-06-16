-- Ensure there is a default site for pre-existing single-tenant assets.
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
    'Demo Site',
    'example.com',
    'staging.example.com',
    'de',
    'https://example.com',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "sites" WHERE "key" = 'demo');

ALTER TABLE "assets" ADD COLUMN "site_id" TEXT;
UPDATE "assets" SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo') WHERE "site_id" IS NULL;
ALTER TABLE "assets" ALTER COLUMN "site_id" SET NOT NULL;
ALTER TABLE "assets" ADD CONSTRAINT "assets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
