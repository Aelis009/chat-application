ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "editedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz;

ALTER TABLE "group_messages"
  ADD COLUMN IF NOT EXISTS "editedAt" timestamptz,
  ADD COLUMN IF NOT EXISTS "deletedAt" timestamptz;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(50) NOT NULL,
  "title" varchar(160) NOT NULL,
  "body" text NOT NULL,
  "data" text,
  "readAt" timestamptz,
  "createdAt" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx"
  ON "notifications" ("userId")
  WHERE "readAt" IS NULL;
