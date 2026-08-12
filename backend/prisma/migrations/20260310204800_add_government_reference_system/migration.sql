-- CreateTable
CREATE TABLE "GovernmentReference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "masterReferenceId" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortTitle" TEXT,
    "sourceUrl" TEXT,
    "chamber" TEXT,
    "congress" INTEGER,
    "status" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "fullText" TEXT,
    "signedDate" DATETIME,
    "decidedDate" DATETIME,
    "aliases" TEXT,
    "mergedIntoId" TEXT,
    "supportVotes" INTEGER NOT NULL DEFAULT 0,
    "opposeVotes" INTEGER NOT NULL DEFAULT 0,
    "totalComments" INTEGER NOT NULL DEFAULT 0,
    "totalShares" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GovernmentReference_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "GovernmentReference" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GovernmentReferenceVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "governmentReferenceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GovernmentReferenceVote_governmentReferenceId_fkey" FOREIGN KEY ("governmentReferenceId") REFERENCES "GovernmentReference" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Post" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "billId" TEXT,
    "governmentReferenceId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "referenceTitle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Post_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_governmentReferenceId_fkey" FOREIGN KEY ("governmentReferenceId") REFERENCES "GovernmentReference" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Post" ("authorId", "billId", "content", "createdAt", "id", "referenceId", "referenceTitle", "referenceType", "updatedAt") SELECT "authorId", "billId", "content", "createdAt", "id", "referenceId", "referenceTitle", "referenceType", "updatedAt" FROM "Post";
DROP TABLE "Post";
ALTER TABLE "new_Post" RENAME TO "Post";
CREATE INDEX "Post_authorId_idx" ON "Post"("authorId");
CREATE INDEX "Post_billId_idx" ON "Post"("billId");
CREATE INDEX "Post_governmentReferenceId_idx" ON "Post"("governmentReferenceId");
CREATE INDEX "Post_referenceType_idx" ON "Post"("referenceType");
CREATE INDEX "Post_referenceId_idx" ON "Post"("referenceId");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "GovernmentReference_masterReferenceId_key" ON "GovernmentReference"("masterReferenceId");

-- CreateIndex
CREATE INDEX "GovernmentReference_referenceType_idx" ON "GovernmentReference"("referenceType");

-- CreateIndex
CREATE INDEX "GovernmentReference_status_idx" ON "GovernmentReference"("status");

-- CreateIndex
CREATE INDEX "GovernmentReference_category_idx" ON "GovernmentReference"("category");

-- CreateIndex
CREATE INDEX "GovernmentReference_createdAt_idx" ON "GovernmentReference"("createdAt");

-- CreateIndex
CREATE INDEX "GovernmentReference_supportVotes_idx" ON "GovernmentReference"("supportVotes");

-- CreateIndex
CREATE INDEX "GovernmentReference_opposeVotes_idx" ON "GovernmentReference"("opposeVotes");

-- CreateIndex
CREATE INDEX "GovernmentReference_mergedIntoId_idx" ON "GovernmentReference"("mergedIntoId");

-- CreateIndex
CREATE INDEX "GovernmentReferenceVote_governmentReferenceId_idx" ON "GovernmentReferenceVote"("governmentReferenceId");

-- CreateIndex
CREATE INDEX "GovernmentReferenceVote_userId_idx" ON "GovernmentReferenceVote"("userId");

-- CreateIndex
CREATE INDEX "GovernmentReferenceVote_position_idx" ON "GovernmentReferenceVote"("position");

-- CreateIndex
CREATE UNIQUE INDEX "GovernmentReferenceVote_governmentReferenceId_userId_key" ON "GovernmentReferenceVote"("governmentReferenceId", "userId");
