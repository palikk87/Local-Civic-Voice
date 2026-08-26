-- Which citizen account a business account was converted from.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL. Every B2BClient that exists today was
-- minted from nothing, and null says exactly that. A default would be an
-- invented answer about where an account came from.
--
-- UNIQUE, so one person cannot quietly end up behind two business accounts.
-- Postgres treats nulls as distinct in a unique index, so the many existing
-- clients with no link do not collide with each other.
--
-- NO FOREIGN KEY, and this is deliberate rather than an omission. If the person
-- closes their citizen account, the business account and everything billed
-- against it must not go with it — the company is not the person. The link goes
-- stale, which is the honest outcome.
--
-- ADDITIVE AND IDEMPOTENT. This database is shared with another project.
ALTER TABLE "B2BClient" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "B2BClient_userId_key" ON "B2BClient"("userId");
