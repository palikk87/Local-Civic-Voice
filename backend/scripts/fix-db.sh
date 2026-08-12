#!/bin/bash

# This script directly fixes the database schema to match Prisma requirements
# Run this if admin login or other features are broken due to missing tables/columns

source "$(dirname "$0")/env.sh"

if [[ -z "${SUPABASE_DATABASE_URL}" ]]; then
  echo "Error: SUPABASE_DATABASE_URL not set"
  exit 1
fi

echo "Fixing database schema..."

# Create SQL with all required fixes
cat > /tmp/fix_schema.sql <<'EOSQL'
-- Create AdminSession table
CREATE TABLE IF NOT EXISTS "AdminSession" (
    "token" TEXT PRIMARY KEY,
    "adminId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "AdminSession_adminId_idx" ON "AdminSession"("adminId");
CREATE INDEX IF NOT EXISTS "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- Add missing columns to GovernmentReference
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedSupport" INTEGER DEFAULT 0;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "seedOppose" INTEGER DEFAULT 0;
ALTER TABLE "GovernmentReference" ADD COLUMN IF NOT EXISTS "citizenBrief" TEXT;
EOSQL

# Execute using psql directly
psql "$SUPABASE_DATABASE_URL" < /tmp/fix_schema.sql && echo "Database schema fixed successfully!" || echo "Warning: Some schema updates may have failed (they might already exist)"

rm -f /tmp/fix_schema.sql
