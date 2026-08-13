-- Direct messaging persistence.
--
-- routes/messages.ts previously served an in-memory mock: a hardcoded
-- "current_user", module-level arrays, and integer counters. Every restart wiped
-- it, and every caller saw the same fake conversations. These tables replace it.
--
-- SAFETY
--
-- Additive only. Every statement is IF NOT EXISTS, so this is safe to re-run and
-- safe against a database the mobile client is also writing to. Foreign keys are
-- declared inline in CREATE TABLE (Postgres has no ADD CONSTRAINT IF NOT EXISTS),
-- which keeps the whole migration idempotent without DO blocks.

CREATE TABLE IF NOT EXISTS "Conversation" (
    "id"        TEXT NOT NULL PRIMARY KEY,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Conversation lists are ordered by most recent activity.
CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

CREATE TABLE IF NOT EXISTS "ConversationParticipant" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "userId"         TEXT NOT NULL REFERENCES "User"("id")         ON DELETE CASCADE ON UPDATE CASCADE,
    "lastReadAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per user per conversation. Also the membership lookup that every
-- message endpoint uses to authorize a caller.
CREATE UNIQUE INDEX IF NOT EXISTS "ConversationParticipant_conversationId_userId_key"
    ON "ConversationParticipant"("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "ConversationParticipant_userId_idx"
    ON "ConversationParticipant"("userId");

CREATE TABLE IF NOT EXISTS "Message" (
    "id"             TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "senderId"       TEXT NOT NULL REFERENCES "User"("id")         ON DELETE CASCADE ON UPDATE CASCADE,
    "content"        TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Paging a thread is (conversationId, createdAt) ordered.
CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx"
    ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");
