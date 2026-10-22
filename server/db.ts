import "dotenv/config";
import pg from "pg";
const { Pool } = pg;
import type { InsertUser, User } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { runMigrations } from "./migrations";
import type { EventLogEntry, EventType } from "./events";

let _pool: pg.Pool | null = null;
let _cachedUrl: string | undefined = undefined;

export function getPool(): pg.Pool | null {
  const currentUrl = process.env.DATABASE_URL?.trim();
  if (!currentUrl) {
    return null;
  }

  if (!_pool || _cachedUrl !== currentUrl) {
    if (_pool) {
      _pool.end().catch(() => {});
      _pool = null;
    }
    _cachedUrl = currentUrl;
    const isNeon =
      currentUrl.includes("neon.tech") ||
      currentUrl.includes("sslmode=");
    _pool = new Pool({
      connectionString: currentUrl,
      // Serverless functions run many copies at once, so keep each copy to a few connections.
      max: Number(process.env.PG_POOL_MAX || 5),
      ssl:
        isNeon || process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });

    _pool.on("error", (err) => {
      console.error("[Database] Unexpected idle client error:", err);
    });
  }
  return _pool;
}

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}

export function requirePool(): pg.Pool {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database is not configured. DATABASE_URL is missing.");
  }
  return pool;
}

// Retain getDb signature for compatibility
export async function getDb() {
  return getPool();
}

export async function initDatabase(): Promise<boolean> {
  if (!isDbConfigured()) {
    console.warn("[Database] DATABASE_URL is not set. Database features are disabled.");
    return false;
  }

  try {
    const pool = requirePool();
    await runMigrations(pool);
    return true;
  } catch (error) {
    console.error("[Database] Failed to initialize database:", error);
    return false;
  }
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const pool = requirePool();

  const role =
    user.role !== undefined
      ? user.role
      : user.openId === ENV.ownerOpenId
      ? "admin"
      : "user";

  const lastSignedIn = user.lastSignedIn ?? new Date();

  await pool.query(
    `
    INSERT INTO users ("openId", name, email, "loginMethod", role, "lastSignedIn")
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT ("openId")
    DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      email = COALESCE(EXCLUDED.email, users.email),
      "loginMethod" = COALESCE(EXCLUDED."loginMethod", users."loginMethod"),
      role = EXCLUDED.role,
      "lastSignedIn" = EXCLUDED."lastSignedIn",
      "updatedAt" = NOW()
    `,
    [
      user.openId,
      user.name ?? null,
      user.email ?? null,
      user.loginMethod ?? null,
      role,
      lastSignedIn,
    ]
  );
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const pool = getPool();
  if (!pool) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const { rows } = await pool.query<User>(
    `
    SELECT id, "openId", name, email, "loginMethod", role, "createdAt", "updatedAt", "lastSignedIn"
    FROM users
    WHERE "openId" = $1
    LIMIT 1
    `,
    [openId]
  );

  return rows[0];
}

export interface AppendEventParams {
  branchId?: string;
  type: string;
  payload: any;
  source?: string;
}

export async function appendEventToLog(
  params: AppendEventParams
): Promise<EventLogEntry> {
  const pool = requirePool();
  const branchId = params.branchId || "main";
  const source = params.source || "api";

  const { rows } = await pool.query(
    `
    INSERT INTO event_log (branch_id, "type", payload, "source")
    VALUES ($1, $2, $3, $4)
    RETURNING "offset", branch_id, "type", payload, "source", created_at
    `,
    [branchId, params.type, JSON.stringify(params.payload ?? {}), source]
  );

  const row = rows[0];
  return {
    offset: Number(row.offset),
    branch_id: row.branch_id,
    type: row.type as EventType,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    source: row.source,
    created_at: row.created_at,
  };
}

export interface ReadEventsParams {
  branchId?: string;
  fromOffset?: number;
  upToOffset?: number;
  limit?: number;
}

export async function readEventsFromLog(
  params: ReadEventsParams = {}
): Promise<EventLogEntry[]> {
  const pool = requirePool();
  const branchId = params.branchId || "main";
  const limit = Math.min(params.limit || 1000, 5000);

  const conditions: string[] = ["branch_id = $1"];
  const values: any[] = [branchId];

  if (params.fromOffset !== undefined) {
    values.push(params.fromOffset);
    conditions.push(`"offset" >= $${values.length}`);
  }

  if (params.upToOffset !== undefined) {
    values.push(params.upToOffset);
    conditions.push(`"offset" <= $${values.length}`);
  }

  values.push(limit);

  const query = `
    SELECT "offset", branch_id, "type", payload, "source", created_at
    FROM event_log
    WHERE ${conditions.join(" AND ")}
    ORDER BY "offset" ASC
    LIMIT $${values.length}
  `;

  const { rows } = await pool.query(query, values);

  return rows.map((row) => ({
    offset: Number(row.offset),
    branch_id: row.branch_id,
    type: row.type as EventType,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    source: row.source,
    created_at: row.created_at,
  }));
}
