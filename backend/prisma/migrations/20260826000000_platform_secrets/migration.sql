-- API keys held with the platform's own data rather than in a hosting
-- provider's environment panel.
--
-- ADDITIVE AND IDEMPOTENT, like every migration here: this database is shared
-- with another project, so a migration that drops or rewrites anything can take
-- something that is not ours with it. IF NOT EXISTS throughout, no ALTER of an
-- existing table, and no data touched.
--
-- "ciphertext" is AES-256-GCM under SECRETS_ENCRYPTION_KEY, which lives in the
-- environment and is never stored here. There is no column that can hold a key
-- in the clear.
CREATE TABLE IF NOT EXISTS "PlatformSecret" (
    "name"        TEXT NOT NULL,
    "ciphertext"  TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "length"      INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedBy"   TEXT,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformSecret_pkey" PRIMARY KEY ("name")
);
