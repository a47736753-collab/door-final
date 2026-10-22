import type { Pool } from "pg";

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  forked_from_branch TEXT REFERENCES branches(id) ON DELETE SET NULL,
  fork_offset BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO branches (id, name)
VALUES ('main', 'main')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_log (
  "offset" BIGSERIAL PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source" TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conflict_deltas (
  id BIGSERIAL PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  "offset" BIGINT NOT NULL,
  issue_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('opened', 'resolved')),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS acoustic_frames (
  id BIGSERIAL PRIMARY KEY,
  raw_hex TEXT NOT NULL,
  volunteer_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS volunteer_keys (
  volunteer_id TEXT PRIMARY KEY,
  secret_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  "openId" VARCHAR(64) NOT NULL UNIQUE,
  name TEXT,
  email VARCHAR(320),
  "loginMethod" VARCHAR(64),
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastSignedIn" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(MIGRATION_SQL);
    await client.query("COMMIT");
    console.log("[Database] PostgreSQL migrations executed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[Database] Migration failed:", error);
    throw error;
  } finally {
    client.release();
  }
}
