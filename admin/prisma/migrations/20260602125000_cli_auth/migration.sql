CREATE TABLE IF NOT EXISTS "cli_device_challenges" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_device_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "cli_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cli_tokens_token_hash_key" ON "cli_tokens"("token_hash");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cli_device_challenges_approved_by_id_fkey'
    ) THEN
        ALTER TABLE "cli_device_challenges"
        ADD CONSTRAINT "cli_device_challenges_approved_by_id_fkey"
        FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cli_tokens_user_id_fkey'
    ) THEN
        ALTER TABLE "cli_tokens"
        ADD CONSTRAINT "cli_tokens_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
