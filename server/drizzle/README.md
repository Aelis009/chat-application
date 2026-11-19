# Database migrations

Production schema changes live here as reviewed, additive SQL files.

Apply them manually in the Neon SQL Editor in numeric order. Do not run
`drizzle-kit push` against the production database.

## Stage 3

Apply `0001_add_message_read_at.sql` before deploying the Stage 3 code.

The migration:

- adds `messages.readAt` for unread tracking;
- treats existing messages as already read;
- adds indexes for message history and unread counts.

It is safe to run again. Re-running it does not mark new unread messages as
read.
