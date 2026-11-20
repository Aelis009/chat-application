ALTER TABLE "groups"
  ADD COLUMN IF NOT EXISTS "onlyAdminsCanSend" boolean DEFAULT false NOT NULL;
