-- Stage 3: add persistent read tracking for private messages.
--
-- This migration is additive. It does not delete or rewrite message content,
-- users, or friendships.
--
-- Existing messages are treated as already read so old history does not appear
-- as unread. The temporary default is removed immediately, so every new
-- message starts with readAt = NULL (unread) until its recipient opens it.
--
-- Apply this file with the Neon SQL Editor (or another reviewed SQL runner).
-- Do not run `drizzle-kit push` against production.
--
-- The IF NOT EXISTS / DROP DEFAULT clauses make the migration safe to re-run.
-- Run the whole file as one transaction so a failed step rolls back cleanly.

BEGIN;

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "readAt" timestamp with time zone DEFAULT now();

ALTER TABLE "messages"
  ALTER COLUMN "readAt" DROP DEFAULT;

CREATE INDEX IF NOT EXISTS "messages_pair_created_idx"
  ON "messages" ("senderId", "receiverId", "createdAt");

CREATE INDEX IF NOT EXISTS "messages_receiver_unread_idx"
  ON "messages" ("receiverId")
  WHERE "readAt" IS NULL;

COMMIT;
