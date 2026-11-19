import "dotenv/config";
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing in server/.env");
}

const sql = neon(databaseUrl);
const migrationPath = new URL(
  "./drizzle/0001_add_message_read_at.sql",
  import.meta.url
);
const migrationSql = await readFile(migrationPath, "utf8");

const statements = migrationSql
  .replace(/--.*$/gm, "")
  .replace(/^\s*BEGIN;\s*$/gim, "")
  .replace(/^\s*COMMIT;\s*$/gim, "")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

if (statements.length !== 4) {
  throw new Error(`Expected 4 migration statements, found ${statements.length}`);
}

const expectedPrefixes = [
  'ALTER TABLE "messages"\n  ADD COLUMN IF NOT EXISTS "readAt"',
  'ALTER TABLE "messages"\n  ALTER COLUMN "readAt" DROP DEFAULT',
  'CREATE INDEX IF NOT EXISTS "messages_pair_created_idx"',
  'CREATE INDEX IF NOT EXISTS "messages_receiver_unread_idx"',
];

for (let index = 0; index < expectedPrefixes.length; index += 1) {
  if (!statements[index].startsWith(expectedPrefixes[index])) {
    throw new Error(`Unexpected migration statement ${index + 1}`);
  }
}

const before = await sql.query(`
  SELECT
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'messages'
        AND column_name = 'readAt'
    ) AS "hasReadAt",
    (SELECT count(*)::int FROM messages) AS "messageCount"
`);

const beforeState = before[0];

if (beforeState.hasReadAt) {
  console.log(
    JSON.stringify(
      {
        applied: false,
        reason: "messages.readAt already exists; no changes were made.",
        messageCount: beforeState.messageCount,
      },
      null,
      2
    )
  );
  process.exit(0);
}

await sql.transaction((transaction) =>
  statements.map((statement) => transaction.query(statement))
);

const afterColumns = await sql.query(`
  SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'messages'
    AND column_name = 'readAt'
`);

const afterIndexes = await sql.query(`
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'messages'
    AND indexname IN (
      'messages_pair_created_idx',
      'messages_receiver_unread_idx'
    )
  ORDER BY indexname
`);

const afterData = await sql.query(`
  SELECT
    count(*)::int AS "messageCount",
    count(*) FILTER (WHERE "readAt" IS NULL)::int AS "unreadCount"
  FROM messages
`);

console.log(
  JSON.stringify(
    {
      applied: true,
      before: beforeState,
      readAtColumn: afterColumns[0] ?? null,
      indexes: afterIndexes,
      after: afterData[0],
    },
    null,
    2
  )
);
