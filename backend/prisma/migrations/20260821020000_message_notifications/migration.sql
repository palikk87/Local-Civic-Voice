-- "Somebody sent you a message" becomes a notification you can turn off.
--
-- One boolean with a default, so every existing row gets it without a rewrite
-- and nobody has to opt in to being told about their own inbox.

-- AlterTable
ALTER TABLE "NotificationPreference" ADD COLUMN     "messages" BOOLEAN NOT NULL DEFAULT true;

