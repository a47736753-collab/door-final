// server/_core/app.ts
import "dotenv/config";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "webdev_app_session";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import "dotenv/config";
import pg from "pg";

// server/_core/env.ts
var ENV = {
  get appId() {
    return process.env.MANUS_PROJECT_ID ?? "";
  },
  get cookieSecret() {
    return process.env.MANUS_JWT_SECRET ?? "";
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  get oAuthServerUrl() {
    return process.env.MANUS_OAUTH_API_URL ?? "";
  },
  // Preserve the legacy hint when supplied; otherwise roles remain application data.
  get ownerOpenId() {
    return process.env.OWNER_OPEN_ID ?? "";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get forgeApiUrl() {
    return process.env.MANUS_API_URL ?? "";
  },
  get forgeApiKey() {
    return process.env.MANUS_API_KEY ?? "";
  }
};

// server/migrations.ts
var MIGRATION_SQL = `
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
async function runMigrations(pool) {
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

// server/db.ts
var { Pool } = pg;
var _pool = null;
var _cachedUrl = void 0;
function getPool() {
  const currentUrl = process.env.DATABASE_URL?.trim();
  if (!currentUrl) {
    return null;
  }
  if (!_pool || _cachedUrl !== currentUrl) {
    if (_pool) {
      _pool.end().catch(() => {
      });
      _pool = null;
    }
    _cachedUrl = currentUrl;
    const isNeon = currentUrl.includes("neon.tech") || currentUrl.includes("sslmode=");
    _pool = new Pool({
      connectionString: currentUrl,
      // Serverless functions run many copies at once, so keep each copy to a few connections.
      max: Number(process.env.PG_POOL_MAX || 5),
      ssl: isNeon || process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : void 0
    });
    _pool.on("error", (err) => {
      console.error("[Database] Unexpected idle client error:", err);
    });
  }
  return _pool;
}
function isDbConfigured() {
  return Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
}
function requirePool() {
  const pool = getPool();
  if (!pool) {
    throw new Error("Database is not configured. DATABASE_URL is missing.");
  }
  return pool;
}
async function initDatabase() {
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
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const pool = requirePool();
  const role = user.role !== void 0 ? user.role : user.openId === ENV.ownerOpenId ? "admin" : "user";
  const lastSignedIn = user.lastSignedIn ?? /* @__PURE__ */ new Date();
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
      lastSignedIn
    ]
  );
}
async function getUserByOpenId(openId) {
  const pool = getPool();
  if (!pool) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const { rows } = await pool.query(
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
async function readEventsFromLog(params = {}) {
  const pool = requirePool();
  const branchId = params.branchId || "main";
  const limit = Math.min(params.limit || 1e3, 5e3);
  const conditions = ["branch_id = $1"];
  const values = [branchId];
  if (params.fromOffset !== void 0) {
    values.push(params.fromOffset);
    conditions.push(`"offset" >= $${values.length}`);
  }
  if (params.upToOffset !== void 0) {
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
    type: row.type,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    source: row.source,
    created_at: row.created_at
  }));
}

// server/_core/cookies.ts
function getSessionCookieOptions(_req) {
  return { httpOnly: true, path: "/", sameSite: "none", secure: true };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
  statusCode;
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    if (ENV.oAuthServerUrl) {
      console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    }
  }
  client;
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    if (!secret) throw new Error("MANUS_JWT_SECRET is unavailable");
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || (!isNonEmptyString(appId) || appId !== ENV.appId) || typeof name !== "string") {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken && req.path.startsWith("/api/scheduled/")) {
      const ticket = cookies.get("app_session_id");
      const identity = await this.verifySession(ticket);
      if (identity?.openId.startsWith(CRON_OPEN_ID_PREFIX)) sessionToken = ticket;
    }
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app2) {
  app2.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error instanceof Error ? error.message : "unknown error");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/publicConfig.ts
function publicPlatformConfig(env = process.env) {
  return {
    projectId: env.MANUS_PROJECT_ID ?? "",
    oauthPortalUrl: env.MANUS_OAUTH_PORTAL_URL ?? "",
    apiUrl: env.MANUS_API_URL ?? "",
    apiBrowserKey: env.MANUS_API_BROWSER_KEY ?? ""
  };
}
function publicPlatformScript(env = process.env) {
  const json = JSON.stringify(publicPlatformConfig(env)).replaceAll("<", "\\u003c");
  return `window.__MANUS_CONFIG__=${json};`;
}

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// client/src/features/doorsopen/types.ts
function timeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;
  return hours * 60 + minutes;
}

// client/src/features/doorsopen/checks.ts
function overlap(aStart, aEnd, bStart, bEnd) {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  return Number.isFinite(as) && Number.isFinite(ae) && Number.isFinite(bs) && Number.isFinite(be) && as < be && bs < ae;
}
function entity(id, kind, label) {
  return { id, kind, label };
}
function sessionLink(session, plan) {
  const venue = plan.venues.find((item) => item.id === session.venueId);
  return entity(session.id, "session", session.title + (venue ? ` \xB7 ${venue.name}` : ""));
}
function taskSeverity(task, now) {
  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return "critical";
  if (task.priority === "high" || due.getTime() - now.getTime() < 48 * 60 * 60 * 1e3) return "warning";
  return "info";
}
function runChecks(plan, now = /* @__PURE__ */ new Date()) {
  const issues = [];
  const sessions = plan.sessions;
  const venueById = new Map(plan.venues.map((venue) => [venue.id, venue]));
  const volunteersById = new Map(plan.volunteers.map((volunteer) => [volunteer.id, volunteer]));
  const equipmentById = new Map(plan.equipment.map((item) => [item.id, item]));
  for (let index = 0; index < sessions.length; index += 1) {
    const current = sessions[index];
    const venue = venueById.get(current.venueId);
    if (!venue) {
      issues.push({
        id: `data:missing-venue:${current.id}`,
        kind: "data",
        severity: "critical",
        title: `${current.title} has no venue`,
        explanation: "This activity points to a venue that is not in the event plan.",
        recommendation: "Assign an existing venue or import the missing venue record.",
        links: [sessionLink(current, plan)]
      });
    } else if (current.expectedAttendance > venue.capacity) {
      issues.push({
        id: `capacity:${current.id}`,
        kind: "capacity",
        severity: "critical",
        title: `${venue.name} exceeds capacity`,
        explanation: `${current.title} expects ${current.expectedAttendance} attendees, above ${venue.name}'s capacity of ${venue.capacity}.`,
        recommendation: "Move the session to a venue with enough capacity or reduce the expected attendance.",
        links: [sessionLink(current, plan), entity(venue.id, "venue", venue.name)]
      });
    }
    const start = timeToMinutes(current.start);
    const end = timeToMinutes(current.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      issues.push({
        id: `data:invalid-time:${current.id}`,
        kind: "data",
        severity: "critical",
        title: `${current.title} has an invalid time`,
        explanation: `The entered time range ${current.start}\u2013${current.end} is not a valid same-day interval.`,
        recommendation: "Enter a valid start and end time; the end must be after the start.",
        links: [sessionLink(current, plan)]
      });
    }
    for (const other of sessions.slice(index + 1)) {
      const sameRoom = other.venueId === current.venueId;
      const sameDay = other.dayOffset === current.dayOffset;
      if (sameRoom && sameDay && overlap(current.start, current.end, other.start, other.end)) {
        const roomName = venue?.name ?? "Unassigned venue";
        issues.push({
          id: `room:${[current.id, other.id].sort().join(":")}`,
          kind: "room",
          severity: "critical",
          title: `${roomName} is booked twice`,
          explanation: `${current.title} and ${other.title} overlap from ${current.start}\u2013${current.end} in ${roomName}.`,
          recommendation: "Move one activity to an available venue or adjust its time, then rerun the connected checks.",
          links: [sessionLink(current, plan), sessionLink(other, plan), ...venue ? [entity(venue.id, "venue", venue.name)] : []]
        });
      }
    }
    for (const volunteerId of current.volunteerIds) {
      const volunteer = volunteersById.get(volunteerId);
      if (!volunteer) {
        issues.push({
          id: `data:missing-volunteer:${current.id}:${volunteerId}`,
          kind: "data",
          severity: "warning",
          title: `${current.title} has an unknown volunteer`,
          explanation: `Volunteer reference ${volunteerId} is missing from the volunteer roster.`,
          recommendation: "Add the volunteer to Resources or correct the assignment.",
          links: [sessionLink(current, plan)]
        });
        continue;
      }
      if (timeToMinutes(current.start) < timeToMinutes(volunteer.availableFrom) || timeToMinutes(current.end) > timeToMinutes(volunteer.availableTo)) {
        issues.push({
          id: `volunteer:availability:${current.id}:${volunteer.id}`,
          kind: "volunteer",
          severity: "warning",
          title: `${volunteer.name} is outside their available hours`,
          explanation: `${current.title} runs ${current.start}\u2013${current.end}, but ${volunteer.name} is available ${volunteer.availableFrom}\u2013${volunteer.availableTo}.`,
          recommendation: "Confirm availability or reassign this activity to another volunteer.",
          links: [sessionLink(current, plan), entity(volunteer.id, "volunteer", volunteer.name)]
        });
      }
      for (const other of sessions.slice(index + 1)) {
        if (other.dayOffset === current.dayOffset && other.volunteerIds.includes(volunteerId) && overlap(current.start, current.end, other.start, other.end)) {
          issues.push({
            id: `volunteer:${[current.id, other.id].sort().join(":")}:${volunteerId}`,
            kind: "volunteer",
            severity: "critical",
            title: `${volunteer.name} is double-booked`,
            explanation: `${volunteer.name} is assigned to ${current.title} and ${other.title} at the same time.`,
            recommendation: "Reassign one activity or move it outside this volunteer's assignment window.",
            links: [sessionLink(current, plan), sessionLink(other, plan), entity(volunteer.id, "volunteer", volunteer.name)]
          });
        }
      }
    }
    for (const equipmentId of current.equipmentIds) {
      const item = equipmentById.get(equipmentId);
      if (!item) {
        issues.push({
          id: `data:missing-equipment:${current.id}:${equipmentId}`,
          kind: "data",
          severity: "warning",
          title: `${current.title} has an unknown equipment item`,
          explanation: `Equipment reference ${equipmentId} is missing from the equipment list.`,
          recommendation: "Add the item to Resources or correct the booking.",
          links: [sessionLink(current, plan)]
        });
        continue;
      }
      if (item.status === "needs-check") {
        issues.push({
          id: `equipment:check:${current.id}:${item.id}`,
          kind: "equipment",
          severity: "warning",
          title: `${item.name} needs a readiness check`,
          explanation: `${item.name} is assigned to ${current.title}, but its status is marked needs-check.`,
          recommendation: "Complete and record the equipment check before the event opens.",
          links: [sessionLink(current, plan), entity(item.id, "equipment", item.name)]
        });
      }
      for (const other of sessions.slice(index + 1)) {
        if (other.dayOffset === current.dayOffset && other.equipmentIds.includes(equipmentId) && overlap(current.start, current.end, other.start, other.end)) {
          issues.push({
            id: `equipment:${[current.id, other.id].sort().join(":")}:${equipmentId}`,
            kind: "equipment",
            severity: "critical",
            title: `${item.name} is double-booked`,
            explanation: `${item.name} is assigned to ${current.title} and ${other.title} during overlapping time slots.`,
            recommendation: "Reassign the equipment or confirm an alternative item for one session; room changes do not resolve this booking.",
            links: [sessionLink(current, plan), sessionLink(other, plan), entity(item.id, "equipment", item.name)]
          });
        }
      }
    }
  }
  for (const task of plan.tasks) {
    if (task.completed) continue;
    const severity = taskSeverity(task, now);
    issues.push({
      id: `task:${task.id}`,
      kind: "task",
      severity,
      title: severity === "critical" ? `${task.title} is overdue` : `${task.title} is still open`,
      explanation: severity === "critical" ? `This ${task.area.toLowerCase()} task passed its due date and is not complete.` : `This ${task.area.toLowerCase()} task has not been marked complete.`,
      recommendation: "Assign an owner, complete the task, and record its status in the readiness checklist.",
      links: [entity(task.id, "task", task.title), ...task.venueId && venueById.get(task.venueId) ? [entity(task.venueId, "venue", venueById.get(task.venueId).name)] : []]
    });
  }
  return issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title));
}
function severityWeight(severity) {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
}

// server/events.ts
function createEmptyPlan() {
  return {
    event: {
      id: "event-init",
      name: "New Event",
      subtitle: "",
      date: (/* @__PURE__ */ new Date()).toISOString(),
      venueName: "",
      isSample: false
    },
    venues: [],
    sessions: [],
    volunteers: [],
    equipment: [],
    tasks: []
  };
}
function replayEvents(events, upToOffset, basePlan) {
  const plan = basePlan ? JSON.parse(JSON.stringify(basePlan)) : createEmptyPlan();
  const filtered = (upToOffset !== void 0 ? events.filter((e) => Number(e.offset) <= upToOffset) : events.slice()).sort((a, b) => Number(a.offset) - Number(b.offset));
  for (const event of filtered) {
    const payload = event.payload;
    switch (event.type) {
      case "PlanImported": {
        const imported = payload.plan;
        if (imported) {
          const next = JSON.parse(JSON.stringify(imported));
          if (payload.rowMap) {
            const rowMap = payload.rowMap;
            if (next.event && rowMap[next.event.id] !== void 0) {
              next.event.csvRow = rowMap[next.event.id];
            }
            next.venues.forEach((v) => {
              if (rowMap[v.id] !== void 0) v.csvRow = rowMap[v.id];
            });
            next.sessions.forEach((s) => {
              if (rowMap[s.id] !== void 0) s.csvRow = rowMap[s.id];
            });
            next.volunteers.forEach((v) => {
              if (rowMap[v.id] !== void 0) v.csvRow = rowMap[v.id];
            });
            next.equipment.forEach((e) => {
              if (rowMap[e.id] !== void 0) e.csvRow = rowMap[e.id];
            });
            next.tasks.forEach((t2) => {
              if (rowMap[t2.id] !== void 0) t2.csvRow = rowMap[t2.id];
            });
          }
          plan.event = next.event;
          plan.venues = next.venues;
          plan.sessions = next.sessions;
          plan.volunteers = next.volunteers;
          plan.equipment = next.equipment;
          plan.tasks = next.tasks;
        }
        break;
      }
      case "SessionMoved": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          session.venueId = payload.venueId;
        }
        break;
      }
      case "SessionTimeChanged": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          session.start = payload.start;
          session.end = payload.end;
          if (payload.dayOffset !== void 0) {
            session.dayOffset = payload.dayOffset;
          }
        }
        break;
      }
      case "VolunteerAssigned": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          const assign = payload.assigned !== false;
          if (assign) {
            if (!session.volunteerIds.includes(payload.volunteerId)) {
              session.volunteerIds.push(payload.volunteerId);
            }
          } else {
            session.volunteerIds = session.volunteerIds.filter(
              (id) => id !== payload.volunteerId
            );
          }
        }
        break;
      }
      case "EquipmentAssigned": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          const assign = payload.assigned !== false;
          if (assign) {
            if (!session.equipmentIds.includes(payload.equipmentId)) {
              session.equipmentIds.push(payload.equipmentId);
            }
          } else {
            session.equipmentIds = session.equipmentIds.filter(
              (id) => id !== payload.equipmentId
            );
          }
        }
        break;
      }
      case "EquipmentStatusChanged": {
        const equip = plan.equipment.find((e) => e.id === payload.equipmentId);
        if (equip) {
          equip.status = payload.status;
        }
        break;
      }
      case "TaskCompleted": {
        const task = plan.tasks.find((t2) => t2.id === payload.taskId);
        if (task) {
          task.completed = payload.completed;
        }
        break;
      }
      case "ConfirmationAccepted": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          session.confirmations = session.confirmations || {};
          session.confirmations[payload.volunteerId] = {
            status: payload.status,
            basedOnOffset: payload.basedOnOffset,
            seq: payload.seq
          };
        }
        break;
      }
      case "ConfirmationRejected": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          session.confirmations = session.confirmations || {};
          session.confirmations[payload.volunteerId] = {
            status: payload.status,
            basedOnOffset: payload.basedOnOffset,
            seq: payload.seq,
            reason: payload.reason
          };
        }
        break;
      }
      case "StaleConfirmationFlagged": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          session.confirmations = session.confirmations || {};
          session.confirmations[payload.volunteerId] = {
            status: payload.status,
            basedOnOffset: payload.basedOnOffset,
            seq: payload.seq,
            reason: payload.reason
          };
        }
        break;
      }
    }
  }
  return plan;
}

// server/affectedResources.ts
function computeAffectedKeys(event, planBefore) {
  const affected = /* @__PURE__ */ new Set();
  const payload = event.payload;
  switch (event.type) {
    case "PlanImported": {
      if (planBefore.event?.id) affected.add(`event:${planBefore.event.id}`);
      planBefore.venues.forEach((v) => affected.add(`venue:${v.id}`));
      planBefore.sessions.forEach((s) => affected.add(`session:${s.id}`));
      planBefore.volunteers.forEach((v) => affected.add(`volunteer:${v.id}`));
      planBefore.equipment.forEach((e) => affected.add(`equipment:${e.id}`));
      planBefore.tasks.forEach((t2) => affected.add(`task:${t2.id}`));
      const importedPlan = payload?.plan;
      if (importedPlan) {
        if (importedPlan.event?.id) affected.add(`event:${importedPlan.event.id}`);
        importedPlan.venues?.forEach((v) => affected.add(`venue:${v.id}`));
        importedPlan.sessions?.forEach((s) => affected.add(`session:${s.id}`));
        importedPlan.volunteers?.forEach((v) => affected.add(`volunteer:${v.id}`));
        importedPlan.equipment?.forEach((e) => affected.add(`equipment:${e.id}`));
        importedPlan.tasks?.forEach((t2) => affected.add(`task:${t2.id}`));
      }
      break;
    }
    case "SessionMoved": {
      const sessionId = payload.sessionId;
      affected.add(`session:${sessionId}`);
      const session = planBefore.sessions.find((s) => s.id === sessionId);
      if (session?.venueId) {
        affected.add(`venue:${session.venueId}`);
      }
      if (payload.venueId) {
        affected.add(`venue:${payload.venueId}`);
      }
      if (session) {
        session.volunteerIds?.forEach((vId) => affected.add(`volunteer:${vId}`));
        session.equipmentIds?.forEach((eId) => affected.add(`equipment:${eId}`));
      }
      break;
    }
    case "SessionTimeChanged": {
      const sessionId = payload.sessionId;
      affected.add(`session:${sessionId}`);
      const session = planBefore.sessions.find((s) => s.id === sessionId);
      if (session) {
        if (session.venueId) affected.add(`venue:${session.venueId}`);
        session.volunteerIds?.forEach((vId) => affected.add(`volunteer:${vId}`));
        session.equipmentIds?.forEach((eId) => affected.add(`equipment:${eId}`));
      }
      break;
    }
    case "VolunteerAssigned": {
      if (payload.sessionId) affected.add(`session:${payload.sessionId}`);
      if (payload.volunteerId) affected.add(`volunteer:${payload.volunteerId}`);
      break;
    }
    case "EquipmentAssigned": {
      if (payload.sessionId) affected.add(`session:${payload.sessionId}`);
      if (payload.equipmentId) affected.add(`equipment:${payload.equipmentId}`);
      break;
    }
    case "EquipmentStatusChanged": {
      const equipmentId = payload.equipmentId;
      affected.add(`equipment:${equipmentId}`);
      planBefore.sessions.forEach((s) => {
        if (s.equipmentIds?.includes(equipmentId)) {
          affected.add(`session:${s.id}`);
        }
      });
      break;
    }
    case "TaskCompleted": {
      if (payload.taskId) {
        affected.add(`task:${payload.taskId}`);
        const task = planBefore.tasks.find((t2) => t2.id === payload.taskId);
        if (task?.venueId) {
          affected.add(`venue:${task.venueId}`);
        }
      }
      break;
    }
    case "ConfirmationAccepted":
    case "ConfirmationRejected":
    case "StaleConfirmationFlagged": {
      if (payload.sessionId) affected.add(`session:${payload.sessionId}`);
      if (payload.volunteerId) affected.add(`volunteer:${payload.volunteerId}`);
      break;
    }
  }
  return affected;
}

// server/incrementalChecker.ts
function runIncrementalChecks(previousIssues, newPlan, affectedKeys, now = /* @__PURE__ */ new Date(), extraIssues = []) {
  const total = newPlan.sessions.length + newPlan.tasks.length;
  if (affectedKeys.size === 0) {
    const map = /* @__PURE__ */ new Map();
    for (const issue of previousIssues) map.set(issue.id, issue);
    for (const issue of extraIssues) map.set(issue.id, issue);
    const sorted = Array.from(map.values()).sort(
      (a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title)
    );
    return {
      issues: sorted,
      recheckCounts: { rechecked: 0, total }
    };
  }
  const connectedSet = /* @__PURE__ */ new Set();
  for (const s of newPlan.sessions) {
    if (affectedKeys.has(`session:${s.id}`) || affectedKeys.has(`venue:${s.venueId}`) || s.volunteerIds?.some((v) => affectedKeys.has(`volunteer:${v}`)) || s.equipmentIds?.some((e) => affectedKeys.has(`equipment:${e}`))) {
      connectedSet.add(s.id);
    }
  }
  let prevSize = 0;
  while (connectedSet.size > prevSize && connectedSet.size < newPlan.sessions.length) {
    prevSize = connectedSet.size;
    const partnerVenues = /* @__PURE__ */ new Set();
    const partnerVolunteers = /* @__PURE__ */ new Set();
    const partnerEquipment = /* @__PURE__ */ new Set();
    for (const s of newPlan.sessions) {
      if (connectedSet.has(s.id)) {
        partnerVenues.add(s.venueId);
        s.volunteerIds?.forEach((v) => partnerVolunteers.add(v));
        s.equipmentIds?.forEach((e) => partnerEquipment.add(e));
      }
    }
    for (const s of newPlan.sessions) {
      if (partnerVenues.has(s.venueId) || s.volunteerIds?.some((v) => partnerVolunteers.has(v)) || s.equipmentIds?.some((e) => partnerEquipment.has(e))) {
        connectedSet.add(s.id);
      }
    }
  }
  const recheckedSessions = newPlan.sessions.filter((s) => connectedSet.has(s.id));
  const recheckedTasks = newPlan.tasks.filter(
    (t2) => affectedKeys.has(`task:${t2.id}`) || t2.venueId && affectedKeys.has(`venue:${t2.venueId}`)
  );
  const rechecked = recheckedSessions.length + recheckedTasks.length;
  const recheckedKeys = new Set(affectedKeys);
  recheckedSessions.forEach((s) => recheckedKeys.add(`session:${s.id}`));
  recheckedTasks.forEach((t2) => recheckedKeys.add(`task:${t2.id}`));
  const keptIssues = previousIssues.filter(
    (issue) => !issue.links.some((link) => recheckedKeys.has(`${link.kind}:${link.id}`))
  );
  let newIssues = [];
  if (recheckedSessions.length > 0 || recheckedTasks.length > 0) {
    const subPlan = {
      event: newPlan.event,
      venues: newPlan.venues,
      sessions: recheckedSessions,
      volunteers: newPlan.volunteers,
      equipment: newPlan.equipment,
      tasks: recheckedTasks
    };
    newIssues = runChecks(subPlan, now);
  }
  const allIssuesMap = /* @__PURE__ */ new Map();
  for (const issue of keptIssues) {
    allIssuesMap.set(issue.id, issue);
  }
  for (const issue of newIssues) {
    allIssuesMap.set(issue.id, issue);
  }
  for (const issue of extraIssues) {
    allIssuesMap.set(issue.id, issue);
  }
  const sessionOrder = new Map(newPlan.sessions.map((s, idx) => [s.id, idx]));
  const getIssuePairOrder = (issue) => {
    const sLinks = issue.links.filter((l) => l.kind === "session").map((l) => sessionOrder.get(l.id) ?? 999999).sort((a, b) => a - b);
    const idx1 = sLinks[0] ?? 999999;
    const idx2 = sLinks[1] ?? -1;
    return [idx1, idx2];
  };
  const sortedIssues = Array.from(allIssuesMap.values()).sort((a, b) => {
    const sDiff = severityWeight(b.severity) - severityWeight(a.severity);
    if (sDiff !== 0) return sDiff;
    const tDiff = a.title.localeCompare(b.title);
    if (tDiff !== 0) return tDiff;
    const [a1, a2] = getIssuePairOrder(a);
    const [b1, b2] = getIssuePairOrder(b);
    if (a1 !== b1) return a1 - b1;
    if (a2 !== b2) return a2 - b2;
    return a.id.localeCompare(b.id);
  });
  return {
    issues: sortedIssues,
    recheckCounts: {
      rechecked,
      total
    }
  };
}

// server/conflictDeltas.ts
function computeDeltas(previousIssues, newIssues) {
  const previousMap = new Map(previousIssues.map((i) => [i.id, i]));
  const newMap = new Map(newIssues.map((i) => [i.id, i]));
  const opened = newIssues.filter((i) => !previousMap.has(i.id));
  const resolved = previousIssues.filter((i) => !newMap.has(i.id));
  return { opened, resolved };
}
function replayDeltas(deltas) {
  const openMap = /* @__PURE__ */ new Map();
  for (const delta of deltas) {
    if (delta.op === "opened") {
      if (delta.payload) {
        const issue = typeof delta.payload === "string" ? JSON.parse(delta.payload) : delta.payload;
        openMap.set(delta.issue_id, issue);
      }
    } else if (delta.op === "resolved") {
      openMap.delete(delta.issue_id);
    }
  }
  return Array.from(openMap.values()).sort(
    (a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title)
  );
}
async function getBranchAncestrySegments(clientOrPool, branchId, targetOffset) {
  const segments = [];
  let currentId = branchId;
  let currentMax = targetOffset;
  while (currentId) {
    const res = await clientOrPool.query(
      `SELECT id, forked_from_branch, fork_offset FROM branches WHERE id = $1`,
      [currentId]
    );
    const rows = res.rows;
    if (rows.length === 0) {
      segments.push({ branchId: currentId, maxOffset: currentMax });
      break;
    }
    const row = rows[0];
    segments.push({ branchId: row.id, maxOffset: currentMax });
    if (row.forked_from_branch && row.fork_offset != null) {
      const forkOffset = Number(row.fork_offset);
      currentMax = currentMax !== void 0 ? Math.min(currentMax, forkOffset) : forkOffset;
      currentId = row.forked_from_branch;
    } else {
      currentId = null;
    }
  }
  return segments.reverse();
}
async function readBranchEventsWithAncestry(clientOrPool, branchId, targetOffset) {
  const segments = await getBranchAncestrySegments(
    clientOrPool,
    branchId,
    targetOffset
  );
  const allEvents = [];
  for (const seg of segments) {
    const values = [seg.branchId];
    let query = `
      SELECT "offset", branch_id, "type", payload, "source", created_at
      FROM event_log
      WHERE branch_id = $1
    `;
    if (seg.maxOffset !== void 0) {
      values.push(seg.maxOffset);
      query += ` AND "offset" <= $${values.length}`;
    }
    query += ` ORDER BY "offset" ASC`;
    const { rows } = await clientOrPool.query(query, values);
    for (const r of rows) {
      allEvents.push({
        offset: Number(r.offset),
        branch_id: r.branch_id,
        type: r.type,
        payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        source: r.source,
        created_at: r.created_at
      });
    }
  }
  return allEvents;
}
async function readBranchDeltasWithAncestry(clientOrPool, branchId, targetOffset) {
  const segments = await getBranchAncestrySegments(
    clientOrPool,
    branchId,
    targetOffset
  );
  const allDeltas = [];
  for (const seg of segments) {
    const values = [seg.branchId];
    let query = `
      SELECT id, branch_id, "offset", issue_id, op, payload, created_at
      FROM conflict_deltas
      WHERE branch_id = $1
    `;
    if (seg.maxOffset !== void 0) {
      values.push(seg.maxOffset);
      query += ` AND "offset" <= $${values.length}`;
    }
    query += ` ORDER BY "offset" ASC, id ASC`;
    const { rows } = await clientOrPool.query(query, values);
    for (const r of rows) {
      allDeltas.push({
        issue_id: r.issue_id,
        op: r.op,
        payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        offset: Number(r.offset)
      });
    }
  }
  return allDeltas;
}
async function conflictSetAt(branchId, offset, clientOrPool) {
  const executor = clientOrPool || requirePool();
  const deltas = await readBranchDeltasWithAncestry(executor, branchId, offset);
  return replayDeltas(deltas);
}
async function appendEventWithDeltas(params) {
  const pool = requirePool();
  const client = await pool.connect();
  const branchId = params.branchId || "main";
  try {
    await client.query("BEGIN");
    const branchRes = await client.query(
      `SELECT id, name, forked_from_branch, fork_offset FROM branches WHERE id = $1 FOR UPDATE`,
      [branchId]
    );
    if (branchRes.rows.length === 0) {
      throw new Error(`Branch '${branchId}' does not exist.`);
    }
    const previousEvents = await readBranchEventsWithAncestry(client, branchId);
    const planBefore = replayEvents(previousEvents);
    const previousDeltas = await readBranchDeltasWithAncestry(client, branchId);
    const previousIssues = replayDeltas(previousDeltas);
    const eventDate = params.createdAt ? new Date(params.createdAt) : params.now ? new Date(params.now) : /* @__PURE__ */ new Date();
    const newEvent = {
      offset: 0,
      // offset assigned by DB
      branch_id: branchId,
      type: params.type,
      payload: params.payload ?? {},
      source: params.source || "api",
      created_at: eventDate
    };
    const affectedKeys = computeAffectedKeys(newEvent, planBefore);
    const newPlan = replayEvents([newEvent], void 0, planBefore);
    const checkResult = runIncrementalChecks(
      previousIssues,
      newPlan,
      affectedKeys,
      eventDate,
      params.extraIssues
    );
    const issueChanges = computeDeltas(previousIssues, checkResult.issues);
    const { rows: eventRows } = await client.query(
      `
      INSERT INTO event_log (branch_id, "type", payload, "source", created_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING "offset", branch_id, "type", payload, "source", created_at
      `,
      [
        branchId,
        newEvent.type,
        JSON.stringify(newEvent.payload),
        newEvent.source,
        eventDate
      ]
    );
    const insertedOffset = Number(eventRows[0].offset);
    const allDeltasToInsert = [
      ...issueChanges.opened.map((i) => ({ issue: i, op: "opened" })),
      ...issueChanges.resolved.map((i) => ({ issue: i, op: "resolved" }))
    ];
    if (allDeltasToInsert.length > 0) {
      const values = [];
      const valueClauses = [];
      for (const item of allDeltasToInsert) {
        const baseIdx = values.length;
        values.push(
          branchId,
          insertedOffset,
          item.issue.id,
          item.op,
          JSON.stringify(item.issue),
          eventDate
        );
        valueClauses.push(
          `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5}, $${baseIdx + 6})`
        );
      }
      await client.query(
        `
        INSERT INTO conflict_deltas (branch_id, "offset", issue_id, op, payload, created_at)
        VALUES ${valueClauses.join(", ")}
        `,
        values
      );
    }
    await client.query("COMMIT");
    return {
      offset: insertedOffset,
      branchId,
      type: newEvent.type,
      payload: newEvent.payload,
      source: newEvent.source || "api",
      createdAt: eventRows[0].created_at,
      issueChanges,
      recheckCounts: checkResult.recheckCounts
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// server/routers.ts
var appendEventInput = z2.object({
  branchId: z2.string().default("main"),
  type: z2.string(),
  payload: z2.record(z2.string(), z2.any()),
  source: z2.string().default("api"),
  createdAt: z2.string().optional()
});
var readEventsInput = z2.object({
  branchId: z2.string().default("main"),
  fromOffset: z2.number().optional(),
  upToOffset: z2.number().optional(),
  limit: z2.number().default(1e3)
}).default({ branchId: "main", limit: 1e3 });
var stateInput = z2.object({
  branchId: z2.string().default("main"),
  offset: z2.number().optional()
}).default({ branchId: "main" });
var conflictsAtInput = z2.object({
  branchId: z2.string().default("main"),
  offset: z2.number()
});
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  events: router({
    appendEvent: publicProcedure.input(appendEventInput).mutation(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing."
        });
      }
      try {
        return await appendEventWithDeltas(input);
      } catch (error) {
        throw new TRPCError3({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to append event with deltas"
        });
      }
    }),
    // Alias for appendEvent
    append: publicProcedure.input(appendEventInput).mutation(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing."
        });
      }
      try {
        return await appendEventWithDeltas(input);
      } catch (error) {
        throw new TRPCError3({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to append event with deltas"
        });
      }
    }),
    readEvents: publicProcedure.input(readEventsInput).query(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing."
        });
      }
      try {
        return await readEventsFromLog(input);
      } catch (error) {
        throw new TRPCError3({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to read events from log"
        });
      }
    }),
    read: publicProcedure.input(readEventsInput).query(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing."
        });
      }
      try {
        return await readEventsFromLog(input);
      } catch (error) {
        throw new TRPCError3({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to read events from log"
        });
      }
    }),
    state: publicProcedure.input(stateInput).query(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing."
        });
      }
      try {
        const pool = getPool();
        if (!pool) throw new Error("Pool unavailable");
        const events = await readBranchEventsWithAncestry(
          pool,
          input.branchId,
          input.offset
        );
        const plan = replayEvents(events);
        const issues = await conflictSetAt(input.branchId, input.offset, pool);
        const latestOffset = input.offset !== void 0 ? input.offset : events.length > 0 ? Number(events[events.length - 1].offset) : 0;
        return {
          branchId: input.branchId,
          offset: latestOffset,
          plan,
          issues
        };
      } catch (error) {
        throw new TRPCError3({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to retrieve branch state"
        });
      }
    }),
    conflictsAt: publicProcedure.input(conflictsAtInput).query(async ({ input }) => {
      if (!isDbConfigured()) {
        throw new TRPCError3({
          code: "PRECONDITION_FAILED",
          message: "Database is not configured. DATABASE_URL is missing."
        });
      }
      try {
        const pool = getPool();
        if (!pool) throw new Error("Pool unavailable");
        const issues = await conflictSetAt(input.branchId, input.offset, pool);
        return {
          branchId: input.branchId,
          offset: input.offset,
          issues
        };
      } catch (error) {
        throw new TRPCError3({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to retrieve conflicts at offset"
        });
      }
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/app.ts
function createApp() {
  const app2 = express();
  let setup = null;
  const ready = () => {
    setup ??= initDatabase().then(() => void 0).catch((error) => {
      console.warn("[Database] Initialization warning, continuing:", error);
    });
    return setup;
  };
  app2.use(express.json({ limit: "50mb" }));
  app2.use(express.urlencoded({ limit: "50mb", extended: true }));
  app2.get("/api/health", (_req, res) => res.json({ status: "ok", database: isDbConfigured() ? "configured" : "not configured" }));
  app2.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app2);
  app2.use("/api/trpc", (_req, _res, next) => {
    ready().then(() => next(), next);
  });
  app2.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  return { app: app2, ready };
}

// server/vercel.ts
var { app } = createApp();
var vercel_default = app;
export {
  vercel_default as default
};
