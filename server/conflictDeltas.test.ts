import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { demoPlan } from "../client/src/features/doorsopen/demo-data";
import { runChecks } from "../client/src/features/doorsopen/checks";
import { getPool, initDatabase, closePool } from "./db";
import {
  appendEventWithDeltas,
  conflictSetAt,
  readBranchEventsWithAncestry,
} from "./conflictDeltas";
import { replayEvents } from "./events";
import { appRouter } from "./routers";

const FIXED_NOW = new Date("2026-11-15T12:00:00.000Z");

describe("PostgreSQL Conflict Deltas, Ancestry & Time Travel", { timeout: 25000 }, () => {
  const isDbAvailable = Boolean(
    process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0
  );

  const testBranchId = `test-branch-${nanoid()}`;
  const forkedBranchId = `test-fork-${nanoid()}`;

  beforeAll(async () => {
    if (!isDbAvailable) return;
    await initDatabase();
    const pool = getPool();
    if (pool) {
      // Create isolated test branches (never write to main)
      await pool.query(
        `INSERT INTO branches (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [testBranchId, testBranchId]
      );
    }
  });

  afterAll(async () => {
    if (!isDbAvailable) return;
    const pool = getPool();
    if (pool) {
      // Clean up test data
      await pool.query(
        `DELETE FROM conflict_deltas WHERE branch_id IN ($1, $2)`,
        [testBranchId, forkedBranchId]
      );
      await pool.query(
        `DELETE FROM event_log WHERE branch_id IN ($1, $2)`,
        [testBranchId, forkedBranchId]
      );
      await pool.query(
        `DELETE FROM branches WHERE id IN ($1, $2)`,
        [testBranchId, forkedBranchId]
      );
    }
    await closePool();
  });

  it("appends an event and saves conflict deltas in the same database transaction", async () => {
    if (!isDbAvailable) return;

    // 1. Append initial PlanImported
    const result1 = await appendEventWithDeltas({
      branchId: testBranchId,
      type: "PlanImported",
      payload: { plan: demoPlan },
      source: "vitest",
      now: FIXED_NOW,
    });

    expect(result1.offset).toBeGreaterThan(0);
    expect(result1.issueChanges.opened.length).toBeGreaterThan(0);

    const pool = getPool()!;
    const { rows: deltaRows1 } = await pool.query(
      `SELECT issue_id, op, "offset" FROM conflict_deltas WHERE branch_id = $1 AND "offset" = $2`,
      [testBranchId, result1.offset]
    );
    expect(deltaRows1.length).toBe(result1.issueChanges.opened.length);

    // 2. Append SessionMoved (moving Robotics to Room C resolves room collision)
    const result2 = await appendEventWithDeltas({
      branchId: testBranchId,
      type: "SessionMoved",
      payload: { sessionId: "session-robotics", venueId: "venue-room-c" },
      source: "vitest",
      now: FIXED_NOW,
    });

    expect(result2.offset).toBeGreaterThan(result1.offset);
    expect(result2.issueChanges.resolved.length).toBeGreaterThan(0);
    expect(
      result2.issueChanges.resolved.some((r) =>
        r.links.some((l) => l.id === "session-robotics")
      )
    ).toBe(true);

    const { rows: deltaRows2 } = await pool.query(
      `SELECT issue_id, op, "offset" FROM conflict_deltas WHERE branch_id = $1 AND "offset" = $2 AND op = 'resolved'`,
      [testBranchId, result2.offset]
    );
    expect(deltaRows2.length).toBe(result2.issueChanges.resolved.length);
  });

  it("time travels via conflictSetAt(branchId, offset) and exactly matches a full recompute", async () => {
    if (!isDbAvailable) return;

    const pool = getPool()!;
    const events = await readBranchEventsWithAncestry(pool, testBranchId);
    expect(events.length).toBeGreaterThanOrEqual(2);

    const offset1 = Number(events[0].offset);
    const offset2 = Number(events[1].offset);

    // Historical open issues at offset1 (before room move)
    const issuesAtOffset1 = await conflictSetAt(testBranchId, offset1);
    const planAtOffset1 = replayEvents(events.filter((e) => Number(e.offset) <= offset1));
    const expectedAtOffset1 = runChecks(planAtOffset1, FIXED_NOW);
    expect(issuesAtOffset1.map((i) => i.id)).toEqual(
      expectedAtOffset1.map((i) => i.id)
    );

    // Open issues at offset2 (after room move)
    const issuesAtOffset2 = await conflictSetAt(testBranchId, offset2);
    const planAtOffset2 = replayEvents(events.filter((e) => Number(e.offset) <= offset2));
    const expectedAtOffset2 = runChecks(planAtOffset2, FIXED_NOW);
    expect(issuesAtOffset2.map((i) => i.id)).toEqual(
      expectedAtOffset2.map((i) => i.id)
    );
  });

  it("works across forked branches: inherits parent events/deltas up to fork_offset followed by its own", async () => {
    if (!isDbAvailable) return;

    const pool = getPool()!;
    const parentEvents = await readBranchEventsWithAncestry(pool, testBranchId);
    const forkOffset = Number(parentEvents[0].offset);

    // Create child branch forked at forkOffset (which only has the PlanImported event)
    await pool.query(
      `INSERT INTO branches (id, name, forked_from_branch, fork_offset) VALUES ($1, $2, $3, $4)`,
      [forkedBranchId, forkedBranchId, testBranchId, forkOffset]
    );

    // In the forked branch, move a different session: session-showcase to venue-room-b
    const childEventResult = await appendEventWithDeltas({
      branchId: forkedBranchId,
      type: "SessionMoved",
      payload: { sessionId: "session-showcase", venueId: "venue-room-b" },
      source: "vitest-child",
      now: FIXED_NOW,
    });

    // 1. Ancestry-aware event reading
    const childEvents = await readBranchEventsWithAncestry(pool, forkedBranchId);
    expect(childEvents.length).toBe(2);
    expect(Number(childEvents[0].offset)).toBe(forkOffset);
    expect(Number(childEvents[1].offset)).toBe(childEventResult.offset);

    // 2. Ancestry-aware conflict set
    const childIssues = await conflictSetAt(forkedBranchId);
    const fullChildPlan = replayEvents(childEvents);
    const expectedChildIssues = runChecks(fullChildPlan, FIXED_NOW);

    expect(childIssues.map((i) => i.id)).toEqual(
      expectedChildIssues.map((i) => i.id)
    );
  });

  it("serializes concurrent appends on the same branch via SELECT ... FOR UPDATE row locking", async () => {
    if (!isDbAvailable) return;

    // Append two events concurrently
    const [append1, append2] = await Promise.all([
      appendEventWithDeltas({
        branchId: testBranchId,
        type: "EquipmentStatusChanged",
        payload: { equipmentId: "equip-projector-1", status: "needs-check" },
        source: "concurrent-1",
        now: FIXED_NOW,
      }),
      appendEventWithDeltas({
        branchId: testBranchId,
        type: "TaskCompleted",
        payload: { taskId: "task-doors", completed: true },
        source: "concurrent-2",
        now: FIXED_NOW,
      }),
    ]);

    expect(append1.offset).toBeDefined();
    expect(append2.offset).toBeDefined();
    expect(append1.offset).not.toBe(append2.offset);

    // Verify the final conflict state matches a full recompute of the entire branch
    const pool = getPool()!;
    const allEvents = await readBranchEventsWithAncestry(pool, testBranchId);
    const finalPlan = replayEvents(allEvents);
    const expectedIssues = runChecks(finalPlan, FIXED_NOW);

    const actualIssues = await conflictSetAt(testBranchId);
    expect(actualIssues.map((i) => i.id)).toEqual(
      expectedIssues.map((i) => i.id)
    );
  });

  it("exposes events.state and events.conflictsAt through tRPC router", async () => {
    if (!isDbAvailable) return;

    const caller = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: null,
    });

    const state = await caller.events.state({ branchId: testBranchId });
    expect(state.branchId).toBe(testBranchId);
    expect(state.plan.sessions.length).toBeGreaterThan(0);
    expect(Array.isArray(state.issues)).toBe(true);

    const conflicts = await caller.events.conflictsAt({
      branchId: testBranchId,
      offset: state.offset,
    });
    expect(conflicts.branchId).toBe(testBranchId);
    expect(conflicts.issues.length).toBe(state.issues.length);
  });
});
