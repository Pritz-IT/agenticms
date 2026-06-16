DO $$
BEGIN
    CREATE TYPE "Role" AS ENUM ('admin', 'editor');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "ContentType" AS ENUM ('text', 'richtext', 'image', 'link', 'page');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "BuildTarget" AS ENUM ('staging', 'production');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "BuildStatus" AS ENUM ('pending', 'building', 'success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "settings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "staging_domain" TEXT NOT NULL,
    "default_locale" TEXT NOT NULL DEFAULT 'de',
    "site_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'editor',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "locales" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "locales_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "layouts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "detected_keys" JSONB NOT NULL DEFAULT '{}',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "layouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "pages" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "layout_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "content" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "type" "ContentType" NOT NULL DEFAULT 'text',

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "navigation" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "target_page_id" TEXT,
    "parent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "navigation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "staging_access" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "staging_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "builds" (
    "id" TEXT NOT NULL,
    "target" "BuildTarget" NOT NULL,
    "status" "BuildStatus" NOT NULL DEFAULT 'pending',
    "output_path" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error_log" TEXT,
    "files_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "builds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "assets" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "submissions" (
    "id" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "score" INTEGER,
    "email" TEXT,
    "client_ref" TEXT,
    "wants_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "locales_code_key" ON "locales"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "layouts_file_path_key" ON "layouts"("file_path");
CREATE UNIQUE INDEX IF NOT EXISTS "pages_path_key" ON "pages"("path");
CREATE UNIQUE INDEX IF NOT EXISTS "content_page_id_key_locale_key" ON "content"("page_id", "key", "locale");
CREATE INDEX IF NOT EXISTS "submissions_form_idx" ON "submissions"("form");
CREATE INDEX IF NOT EXISTS "submissions_client_ref_idx" ON "submissions"("client_ref");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_user_id_fkey'
    ) THEN
        ALTER TABLE "refresh_tokens"
        ADD CONSTRAINT "refresh_tokens_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pages_layout_id_fkey'
    ) THEN
        ALTER TABLE "pages"
        ADD CONSTRAINT "pages_layout_id_fkey"
        FOREIGN KEY ("layout_id") REFERENCES "layouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'content_page_id_fkey'
    ) THEN
        ALTER TABLE "content"
        ADD CONSTRAINT "content_page_id_fkey"
        FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'navigation_target_page_id_fkey'
    ) THEN
        ALTER TABLE "navigation"
        ADD CONSTRAINT "navigation_target_page_id_fkey"
        FOREIGN KEY ("target_page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'navigation_parent_id_fkey'
    ) THEN
        ALTER TABLE "navigation"
        ADD CONSTRAINT "navigation_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "navigation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
