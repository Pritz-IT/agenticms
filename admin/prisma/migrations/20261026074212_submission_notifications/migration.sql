-- CreateEnum
CREATE TYPE "NotifyStatus" AS ENUM ('pending', 'sending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('smtp', 'microsoft', 'google');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "notified_at" TIMESTAMP(3),
ADD COLUMN     "notify_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notify_error" TEXT,
ADD COLUMN     "notify_next_at" TIMESTAMP(3),
ADD COLUMN     "notify_status" "NotifyStatus";

-- CreateTable
CREATE TABLE "site_notification_settings" (
    "site_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "MailProvider",
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "from_address" TEXT,
    "smtp_host" TEXT,
    "smtp_port" INTEGER,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "smtp_user" TEXT,
    "smtp_password_enc" TEXT,
    "oauth_account" TEXT,
    "oauth_refresh_enc" TEXT,
    "oauth_connected_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_notification_settings_pkey" PRIMARY KEY ("site_id")
);

-- CreateIndex
CREATE INDEX "submissions_notify_status_notify_next_at_idx" ON "submissions"("notify_status", "notify_next_at");

-- AddForeignKey
ALTER TABLE "site_notification_settings" ADD CONSTRAINT "site_notification_settings_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
