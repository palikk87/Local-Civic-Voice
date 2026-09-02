-- A member of Congress's portrait, collected the first time anything asks for
-- it and kept from then on. Additive: nothing existing is touched.
CREATE TABLE IF NOT EXISTS "MemberPortrait" (
    "bioguideId" TEXT NOT NULL,
    "image" BYTEA,
    "contentType" TEXT,
    "source" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPortrait_pkey" PRIMARY KEY ("bioguideId")
);

CREATE INDEX IF NOT EXISTS "MemberPortrait_checkedAt_idx" ON "MemberPortrait"("checkedAt");
