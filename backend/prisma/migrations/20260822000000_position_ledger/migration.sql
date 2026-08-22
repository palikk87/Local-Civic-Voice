-- A permanent record of where each citizen stood, and when.
--
-- One new table, additive, nothing existing altered. GovernmentReferenceVote
-- keeps doing exactly what it did — one row per person per record, holding
-- where they stand now, which is what the tally reads.
--
-- This sits alongside it and is append-only: changing your mind adds a row and
-- never erases one. Nothing backfills, so the ledger starts empty and honest
-- rather than inventing a history nobody actually had.

-- CreateTable
CREATE TABLE "PositionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "governmentReferenceId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "lawVersion" INTEGER NOT NULL DEFAULT 1,
    "reason" TEXT,
    "isChange" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionEvent_userId_createdAt_idx" ON "PositionEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PositionEvent_governmentReferenceId_idx" ON "PositionEvent"("governmentReferenceId");

-- CreateIndex
CREATE INDEX "PositionEvent_userId_governmentReferenceId_idx" ON "PositionEvent"("userId", "governmentReferenceId");

-- AddForeignKey
ALTER TABLE "PositionEvent" ADD CONSTRAINT "PositionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionEvent" ADD CONSTRAINT "PositionEvent_governmentReferenceId_fkey" FOREIGN KEY ("governmentReferenceId") REFERENCES "GovernmentReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

