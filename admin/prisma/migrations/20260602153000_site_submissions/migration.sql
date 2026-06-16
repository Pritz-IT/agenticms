INSERT INTO "sites" ("id", "key", "name", "domain", "staging_domain", "default_locale", "site_url", "created_at", "updated_at")
SELECT 'demo', 'demo', 'Demo Site', 'example.com', 'staging.example.com', 'de', 'https://example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "sites" WHERE "key" = 'demo');

ALTER TABLE "submissions" ADD COLUMN "site_id" TEXT;

UPDATE "submissions"
SET "site_id" = (SELECT "id" FROM "sites" WHERE "key" = 'demo')
WHERE "site_id" IS NULL;

ALTER TABLE "submissions" ALTER COLUMN "site_id" SET NOT NULL;

ALTER TABLE "submissions"
ADD CONSTRAINT "submissions_site_id_fkey"
FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "submissions_site_id_form_idx" ON "submissions"("site_id", "form");
CREATE INDEX "submissions_site_id_client_ref_idx" ON "submissions"("site_id", "client_ref");

DROP INDEX IF EXISTS "submissions_form_idx";
DROP INDEX IF EXISTS "submissions_client_ref_idx";
