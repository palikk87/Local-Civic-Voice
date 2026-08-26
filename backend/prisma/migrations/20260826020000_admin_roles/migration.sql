-- Administrative roles, and what each one is allowed to do.
--
-- The platform shipped with three fixed roles whose powers lived in fourteen
-- scattered `role !== "superadmin"` checks. This makes them data, so the person
-- who owns the platform decides what each one means.
--
-- NO BACKFILL AND NO SEED HERE. The two built-in roles are written at boot by
-- services/admin-permissions.ts, which knows the capability keys and can keep
-- them in step as capabilities are added. SQL that hardcodes a list of
-- capability strings would be a second source of truth for them, and the two
-- would drift the first time a capability was renamed.
--
-- EXISTING ACCOUNTS ARE UNTOUCHED. User.role already holds "admin",
-- "moderator" or "superadmin"; those keep working because the seeded rows use
-- exactly those slugs.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project.
CREATE TABLE IF NOT EXISTS "AdminRole" (
    "slug"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "description"  TEXT,
    "capabilities" TEXT NOT NULL,
    "builtIn"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminRole_pkey" PRIMARY KEY ("slug")
);
