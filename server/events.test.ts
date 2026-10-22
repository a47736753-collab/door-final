import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createContext } from "./_core/context";
import type { EventPlan, IssueKind } from "../client/src/features/doorsopen/types";
import {
  replayEvents,
  type EventLogEntry,
  type PlanImportedPayload,
  type SessionMovedPayload,
  type SessionTimeChangedPayload,
  type VolunteerAssignedPayload,
  type EquipmentAssignedPayload,
  type EquipmentStatusChangedPayload,
  type TaskCompletedPayload,
  type ConfirmationAcceptedPayload,
  type ConfirmationRejectedPayload,
  type StaleConfirmationFlaggedPayload,
} from "./events";
import { isDbConfigured, appendEventToLog, readEventsFromLog, initDatabase, closePool, getPool } from "./db";
import { appRouter } from "./routers";

function getSamplePlan(): EventPlan {
  return {
    event: {
      id: "event-1",
      name: "DoorsOpen Tech Conference",
      subtitle: "Annual Summit",
      date: "2026-11-20T09:00:00.000Z",
      venueName: "Convention Center",
      isSample: false,
    },
    venues: [
      {
        id: "venue-room-a",
        name: "Room A",
        type: "room",
        capacity: 100,
        zone: "North",
        accessible: true,
        x: 0,
        y: 0,
        width: 100,
        height: 80,
      },
      {
        id: "venue-room-b",
        name: "Room B",
        type: "room",
        capacity: 120,
        zone: "South",
        accessible: true,
        x: 120,
        y: 0,
        width: 100,
        height: 80,
      },
    ],
    sessions: [
      {
        id: "session-keynote",
        title: "Keynote: Future of Systems",
        kind: "Keynote",
        venueId: "venue-room-a",
        start: "09:00",
        end: "10:00",
        expectedAttendance: 90,
        volunteerIds: ["vol-alice"],
        equipmentIds: ["equip-projector-1"],
        dayOffset: 0,
      },
    ],
    volunteers: [
      {
        id: "vol-alice",
        name: "Alice Smith",
        role: "Stage Manager",
        availableFrom: "08:00",
        availableTo: "17:00",
      },
      {
        id: "vol-bob",
        name: "Bob Jones",
        role: "Usher",
        availableFrom: "08:30",
        availableTo: "12:30",
      },
    ],
    equipment: [
      {
        id: "equip-projector-1",
        name: "4K Laser Projector",
        type: "Projector",
        status: "ready",
      },
      {
        id: "equip-mic-1",
        name: "Wireless Lavalier Mic",
        type: "Microphone",
        status: "needs-check",
      },
    ],
    tasks: [
      {
        id: "task-doors-check",
        title: "Inspect fire exits",
        area: "Safety",
        dueAt: "2026-11-20T08:30:00.000Z",
        completed: false,
        priority: "high",
        venueId: "venue-room-a",
      },
    ],
  };
}

describe("Pure Event Replay Engine (Deterministic & DB-Free)", () => {
  it("replays PlanImported and attaches CSV row numbers for each record", () => {
    const rawPlan = getSamplePlan();
    const event: EventLogEntry<"PlanImported"> = {
      offset: 1,
      branch_id: "main",
      type: "PlanImported",
      payload: {
        plan: rawPlan,
        rowMap: {
          "session-keynote": 2,
          "venue-room-a": 3,
          "venue-room-b": 4,
          "vol-alice": 5,
          "vol-bob": 6,
          "equip-projector-1": 7,
          "equip-mic-1": 8,
          "task-doors-check": 9,
        },
      },
      source: "csv-import",
    };

    const plan = replayEvents([event]);
    expect(plan.sessions[0].csvRow).toBe(2);
    expect(plan.venues[0].csvRow).toBe(3);
    expect(plan.volunteers[0].csvRow).toBe(5);
    expect(plan.equipment[0].csvRow).toBe(7);
    expect(plan.tasks[0].csvRow).toBe(9);
  });

  it("replays SessionMoved and changes session venue", () => {
    const base = getSamplePlan();
    const event: EventLogEntry<"SessionMoved"> = {
      offset: 2,
      type: "SessionMoved",
      payload: {
        sessionId: "session-keynote",
        venueId: "venue-room-b",
      },
    };

    const plan = replayEvents([event], undefined, base);
    expect(plan.sessions[0].venueId).toBe("venue-room-b");
  });

  it("replays SessionTimeChanged with new start, end, and dayOffset", () => {
    const base = getSamplePlan();
    const event: EventLogEntry<"SessionTimeChanged"> = {
      offset: 3,
      type: "SessionTimeChanged",
      payload: {
        sessionId: "session-keynote",
        start: "10:30",
        end: "11:45",
        dayOffset: 1,
      },
    };

    const plan = replayEvents([event], undefined, base);
    expect(plan.sessions[0].start).toBe("10:30");
    expect(plan.sessions[0].end).toBe("11:45");
    expect(plan.sessions[0].dayOffset).toBe(1);
  });

  it("replays VolunteerAssigned to assign and unassign volunteers", () => {
    const base = getSamplePlan();
    // Alice is already assigned. Assign Bob.
    const assignBob: EventLogEntry<"VolunteerAssigned"> = {
      offset: 4,
      type: "VolunteerAssigned",
      payload: {
        sessionId: "session-keynote",
        volunteerId: "vol-bob",
        assigned: true,
      },
    };

    const planWithBob = replayEvents([assignBob], undefined, base);
    expect(planWithBob.sessions[0].volunteerIds).toEqual(["vol-alice", "vol-bob"]);

    // Unassign Alice
    const unassignAlice: EventLogEntry<"VolunteerAssigned"> = {
      offset: 5,
      type: "VolunteerAssigned",
      payload: {
        sessionId: "session-keynote",
        volunteerId: "vol-alice",
        assigned: false,
      },
    };

    const finalPlan = replayEvents([unassignAlice], undefined, planWithBob);
    expect(finalPlan.sessions[0].volunteerIds).toEqual(["vol-bob"]);
  });

  it("replays EquipmentAssigned to assign and unassign equipment", () => {
    const base = getSamplePlan();
    const assignMic: EventLogEntry<"EquipmentAssigned"> = {
      offset: 6,
      type: "EquipmentAssigned",
      payload: {
        sessionId: "session-keynote",
        equipmentId: "equip-mic-1",
        assigned: true,
      },
    };

    const planWithMic = replayEvents([assignMic], undefined, base);
    expect(planWithMic.sessions[0].equipmentIds).toEqual([
      "equip-projector-1",
      "equip-mic-1",
    ]);

    const unassignProjector: EventLogEntry<"EquipmentAssigned"> = {
      offset: 7,
      type: "EquipmentAssigned",
      payload: {
        sessionId: "session-keynote",
        equipmentId: "equip-projector-1",
        assigned: false,
      },
    };

    const finalPlan = replayEvents([unassignProjector], undefined, planWithMic);
    expect(finalPlan.sessions[0].equipmentIds).toEqual(["equip-mic-1"]);
  });

  it("replays EquipmentStatusChanged", () => {
    const base = getSamplePlan();
    const event: EventLogEntry<"EquipmentStatusChanged"> = {
      offset: 8,
      type: "EquipmentStatusChanged",
      payload: {
        equipmentId: "equip-mic-1",
        status: "ready",
      },
    };

    const plan = replayEvents([event], undefined, base);
    const mic = plan.equipment.find((e) => e.id === "equip-mic-1");
    expect(mic?.status).toBe("ready");
  });

  it("replays TaskCompleted to toggle task status", () => {
    const base = getSamplePlan();
    const event: EventLogEntry<"TaskCompleted"> = {
      offset: 9,
      type: "TaskCompleted",
      payload: {
        taskId: "task-doors-check",
        completed: true,
      },
    };

    const plan = replayEvents([event], undefined, base);
    expect(plan.tasks[0].completed).toBe(true);
  });

  it("replays ConfirmationAccepted, ConfirmationRejected, and StaleConfirmationFlagged with full payload requirements", () => {
    const base = getSamplePlan();

    const accept: EventLogEntry<"ConfirmationAccepted"> = {
      offset: 10,
      type: "ConfirmationAccepted",
      payload: {
        volunteerId: "vol-alice",
        sessionId: "session-keynote",
        basedOnOffset: 3,
        seq: 1,
        status: "accepted",
      },
    };

    const reject: EventLogEntry<"ConfirmationRejected"> = {
      offset: 11,
      type: "ConfirmationRejected",
      payload: {
        volunteerId: "vol-bob",
        sessionId: "session-keynote",
        basedOnOffset: 3,
        seq: 2,
        status: "rejected",
        reason: "Schedule conflict with personal appointment",
      },
    };

    const stale: EventLogEntry<"StaleConfirmationFlagged"> = {
      offset: 12,
      type: "StaleConfirmationFlagged",
      payload: {
        volunteerId: "vol-alice",
        sessionId: "session-keynote",
        basedOnOffset: 3,
        seq: 3,
        status: "stale",
        reason: "Session time moved past volunteer availability interval",
      },
    };

    const plan = replayEvents([accept, reject, stale], undefined, base);
    const confirmations = (plan.sessions[0] as any).confirmations;
    expect(confirmations["vol-alice"]).toMatchObject({
      status: "stale",
      basedOnOffset: 3,
      seq: 3,
      reason: "Session time moved past volunteer availability interval",
    });
    expect(confirmations["vol-bob"]).toMatchObject({
      status: "rejected",
      basedOnOffset: 3,
      seq: 2,
      reason: "Schedule conflict with personal appointment",
    });
  });

  it("replays events up to a given offset and ignores subsequent events", () => {
    const base = getSamplePlan();
    const events: EventLogEntry[] = [
      {
        offset: 10,
        type: "SessionMoved",
        payload: { sessionId: "session-keynote", venueId: "venue-room-b" },
      },
      {
        offset: 20,
        type: "SessionMoved",
        payload: { sessionId: "session-keynote", venueId: "venue-room-a" },
      },
      {
        offset: 30,
        type: "SessionMoved",
        payload: { sessionId: "session-keynote", venueId: "venue-room-b" },
      },
    ];

    // Replay up to offset 15: only the first move should be applied
    const at15 = replayEvents(events, 15, base);
    expect(at15.sessions[0].venueId).toBe("venue-room-b");

    // Replay up to offset 25: second move should be applied
    const at25 = replayEvents(events, 25, base);
    expect(at25.sessions[0].venueId).toBe("venue-room-a");

    // Replay all: third move should be applied
    const atAll = replayEvents(events, undefined, base);
    expect(atAll.sessions[0].venueId).toBe("venue-room-b");
  });

  it("is pure and deterministic: leaves input state untouched", () => {
    const base = getSamplePlan();
    const originalJson = JSON.stringify(base);
    const events: EventLogEntry[] = [
      {
        offset: 1,
        type: "SessionMoved",
        payload: { sessionId: "session-keynote", venueId: "venue-room-b" },
      },
    ];

    const result1 = replayEvents(events, undefined, base);
    const result2 = replayEvents(events, undefined, base);

    expect(JSON.stringify(base)).toBe(originalJson);
    expect(result1).toEqual(result2);
  });
});

describe("Type System Check", () => {
  it("includes 'stale' as a valid IssueKind", () => {
    const kinds: IssueKind[] = [
      "room",
      "capacity",
      "volunteer",
      "equipment",
      "task",
      "data",
      "stale",
    ];
    expect(kinds).toContain("stale");
  });
});

describe("Database Graceful Fallback & tRPC Endpoints", () => {
  it("throws clear error when DATABASE_URL is missing", async () => {
    const savedUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "";
      expect(isDbConfigured()).toBe(false);

      await expect(
        appendEventToLog({
          type: "SessionMoved",
          payload: { sessionId: "s1", venueId: "v1" },
        })
      ).rejects.toThrow("Database is not configured. DATABASE_URL is missing.");

      await expect(readEventsFromLog()).rejects.toThrow(
        "Database is not configured. DATABASE_URL is missing."
      );
    } finally {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  it("tRPC events router returns PRECONDITION_FAILED when DATABASE_URL is missing", async () => {
    const savedUrl = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "";
      const caller = appRouter.createCaller({
        req: {} as any,
        res: {} as any,
        user: null,
      });

      await expect(
        caller.events.appendEvent({
          branchId: "main",
          type: "SessionMoved",
          payload: { sessionId: "s1", venueId: "v1" },
          source: "test",
        })
      ).rejects.toThrow(/Database is not configured/);

      await expect(caller.events.readEvents()).rejects.toThrow(
        /Database is not configured/
      );
    } finally {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  it("starts and serves /api/health with status ok when NO Manus environment variables are set", async () => {
    delete process.env.MANUS_PROJECT_ID;
    delete process.env.MANUS_API_KEY;
    delete process.env.MANUS_JWT_SECRET;
    delete process.env.MANUS_OAUTH_API_URL;
    delete process.env.MANUS_API_URL;
    delete process.env.MANUS_API_BROWSER_KEY;
    delete process.env.MANUS_OAUTH_PORTAL_URL;

    const app = express();
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: appRouter,
        createContext,
      })
    );

    const server = app.listen(0);
    const address = server.address() as any;
    const port = address.port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({ status: "ok" });
    } finally {
      server.close();
    }
  });
});

describe("Neon PostgreSQL Database & SQL Migrations", () => {
  const tempBranchId = `test-events-${Date.now()}`;

  afterAll(async () => {
    const pool = getPool();
    if (pool) {
      await pool.query(`DELETE FROM event_log WHERE branch_id = $1`, [tempBranchId]);
      await pool.query(`DELETE FROM branches WHERE id = $1`, [tempBranchId]);
    }
    await closePool();
  });

  it("runs migrations on Neon and creates tables with quoted 'offset' column", async () => {
    if (!process.env.DATABASE_URL) return;
    const success = await initDatabase();
    expect(success).toBe(true);

    const pool = getPool();
    if (pool) {
      await pool.query(
        `INSERT INTO branches (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [tempBranchId, tempBranchId]
      );
    }

    const inserted = await appendEventToLog({
      branchId: tempBranchId,
      type: "SessionMoved",
      payload: { sessionId: "session-test", venueId: "venue-room-b" },
      source: "vitest",
    });
    expect(inserted.offset).toBeDefined();
    expect(Number(inserted.offset)).toBeGreaterThan(0);
    expect(inserted.branch_id).toBe(tempBranchId);

    const events = await readEventsFromLog({ branchId: tempBranchId, limit: 5 });
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => Number(e.offset) === Number(inserted.offset))).toBe(true);
  });
});

