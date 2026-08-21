-- Reposting.
--
-- One nullable column on Post, an index, and a self-referencing foreign key.
-- Nothing existing is altered and no data is rewritten: every row already there
-- gets NULL, which is exactly right — none of them is a repost.
--
-- Safe on a live database. ADD COLUMN without a default rewrites nothing, and
-- the new constraint validates against a column that is entirely NULL.

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "repostOfId" TEXT;

-- CreateIndex
CREATE INDEX "Post_repostOfId_idx" ON "Post"("repostOfId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_repostOfId_fkey" FOREIGN KEY ("repostOfId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

