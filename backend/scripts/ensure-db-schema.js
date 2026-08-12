#!/usr/bin/env bun

/**
 * Ensures the database schema is correct for the application.
 * This runs during startup to create any missing tables/columns.
 */

import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.SUPABASE_DATABASE_URL,
});

async function ensureSchema() {
  try {
    await client.connect();

    // Create AdminSession table if missing
    const adminSessionExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'AdminSession'
      )
    `);

    if (!adminSessionExists.rows[0].exists) {
      await client.query(`
        CREATE TABLE "AdminSession" (
          "token" TEXT NOT NULL PRIMARY KEY,
          "adminId" TEXT NOT NULL,
          "username" TEXT NOT NULL,
          "role" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "expiresAt" TIMESTAMP(3) NOT NULL
        )
      `);

      await client.query(`CREATE INDEX "AdminSession_adminId_idx" ON "AdminSession"("adminId")`);
      await client.query(`CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt")`);
    }

    // Ensure GovernmentReference columns exist
    const seedSupportExists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'GovernmentReference' AND column_name = 'seedSupport'
      )
    `);

    if (!seedSupportExists.rows[0].exists) {
      await client.query(`ALTER TABLE "GovernmentReference" ADD COLUMN "seedSupport" INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE "GovernmentReference" ADD COLUMN "seedOppose" INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE "GovernmentReference" ADD COLUMN "citizenBrief" TEXT`);
    }
  } catch (err) {
    console.error('[DB Schema] Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

ensureSchema();
