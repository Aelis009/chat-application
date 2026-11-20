CREATE TABLE IF NOT EXISTS "groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "createdBy" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "createdAt" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "group_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "groupId" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "userId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" varchar(20) DEFAULT 'member' NOT NULL,
  "joinedAt" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "group_members_group_user_idx"
  ON "group_members" ("groupId", "userId");
CREATE INDEX IF NOT EXISTS "group_members_user_idx"
  ON "group_members" ("userId");

CREATE TABLE IF NOT EXISTS "group_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "groupId" uuid NOT NULL REFERENCES "groups"("id") ON DELETE CASCADE,
  "senderId" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "createdAt" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "group_messages_group_created_idx"
  ON "group_messages" ("groupId", "createdAt");
