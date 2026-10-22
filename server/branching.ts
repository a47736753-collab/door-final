import type { Pool, PoolClient } from "pg";
import { nanoid } from "nanoid";
import type { EventPlan, ReadinessIssue } from "../client/src/features/doorsopen/types";
import { requirePool, getPool } from "./db";
import { replayEvents, type EventLogEntry, type EventType } from "./events";
import { computeAffectedKeys } from "./affectedResources";
import {
  appendEventWithDeltas,
  conflictSetAt,
  readBranchEventsWithAncestry,
} from "./conflictDeltas";

export interface BranchRecord {
  id: string;
  name: string;
  forked_from_branch: string | null;
  fork_offset: number | null;
  created_at: string | Date;
}

export interface BranchComparisonResult {
  before: ReadinessIssue[];
  after: ReadinessIssue[];
  resolved: ReadinessIssue[];
  remaining: ReadinessIssue[];
  introduced: ReadinessIssue[];
}

export interface PromoteBranchResult {
  success: boolean;
  promotedCount: number;
}

/**
 * Creates a new branch forked from a parent branch.
 * If atOffset is omitted, defaults to the parent's latest offset.
 * Branch names must be unique.
 */
export async function createBranch(
  name: string,
  fromBranchId: string = "main",
  atOffset?: number,
  clientOrPool?: Pool | PoolClient
): Promise<BranchRecord> {
  const executor = clientOrPool || requirePool();

  // Check unique branch name
  const existing = await executor.query(
    `SELECT id FROM branches WHERE name = $1 LIMIT 1`,
    [name]
  );
  if (existing.rows.length > 0) {
    throw new Error(`Branch with name '${name}' already exists.`);
  }

  // Ensure parent branch exists
  const parentRes = await executor.query<{ id: string; name: string }>(
    `SELECT id, name FROM branches WHERE id = $1 LIMIT 1`,
    [fromBranchId]
  );
  if (parentRes.rows.length === 0) {
    throw new Error(`Parent branch '${fromBranchId}' does not exist.`);
  }

  // Determine fork offset if not explicitly provided
  let forkOffset = atOffset;
  if (forkOffset === undefined) {
    const parentEvents = await readBranchEventsWithAncestry(
      executor,
      fromBranchId
    );
    forkOffset =
      parentEvents.length > 0
        ? Number(parentEvents[parentEvents.length - 1].offset)
        : 0;
  }

  const branchId = `branch-${nanoid()}`;

  const { rows } = await executor.query<BranchRecord>(
    `
    INSERT INTO branches (id, name, forked_from_branch, fork_offset)
    VALUES ($1, $2, $3, $4)
    RETURNING id, name, forked_from_branch, fork_offset, created_at
    `,
    [branchId, name, fromBranchId, forkOffset]
  );

  return {
    id: rows[0].id,
    name: rows[0].name,
    forked_from_branch: rows[0].forked_from_branch,
    fork_offset: rows[0].fork_offset != null ? Number(rows[0].fork_offset) : null,
    created_at: rows[0].created_at,
  };
}

/**
 * Lists all branches ordered by creation time.
 */
export async function listBranches(
  clientOrPool?: Pool | PoolClient
): Promise<BranchRecord[]> {
  const executor = clientOrPool || requirePool();
  const { rows } = await executor.query<BranchRecord>(
    `SELECT id, name, forked_from_branch, fork_offset, created_at FROM branches ORDER BY created_at ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    forked_from_branch: r.forked_from_branch,
    fork_offset: r.fork_offset != null ? Number(r.fork_offset) : null,
    created_at: r.created_at,
  }));
}

/**
 * Compares two branch heads and returns the conflicts opened, resolved, and unchanged
 * using the same shape as the simulator result.
 */
export async function compareBranches(
  branchAId: string,
  branchBId: string,
  clientOrPool?: Pool | PoolClient
): Promise<BranchComparisonResult> {
  const executor = clientOrPool || requirePool();

  const [before, after] = await Promise.all([
    conflictSetAt(branchAId, undefined, executor),
    conflictSetAt(branchBId, undefined, executor),
  ]);

  const beforeIds = new Set(before.map((i) => i.id));
  const afterIds = new Set(after.map((i) => i.id));

  return {
    before,
    after,
    resolved: before.filter((i) => !afterIds.has(i.id)),
    remaining: after.filter((i) => beforeIds.has(i.id)),
    introduced: after.filter((i) => !beforeIds.has(i.id)),
  };
}

/**
 * Promotes a branch into target branch (intoBranchId).
 * Replays the branch's own events onto the target via appendEventWithDeltas with source: "promoted".
 * Refuses promotion if target has gained events touching the same resources since the fork.
 */
export async function promoteBranch(
  branchId: string,
  intoBranchId: string = "main",
  clientOrPool?: Pool
): Promise<PromoteBranchResult> {
  const pool = clientOrPool || requirePool();

  // 1. Fetch branch information
  const { rows: branchRows } = await pool.query<{
    id: string;
    forked_from_branch: string | null;
    fork_offset: string | number | null;
  }>(
    `SELECT id, forked_from_branch, fork_offset FROM branches WHERE id = $1`,
    [branchId]
  );

  if (branchRows.length === 0) {
    throw new Error(`Branch '${branchId}' does not exist.`);
  }

  const branch = branchRows[0];
  const forkOffset = Number(branch.fork_offset ?? 0);

  // 2. Fetch the branch's OWN events (events written directly on this branch)
  const { rows: ownEventRows } = await pool.query<{
    offset: string | number;
    type: string;
    payload: any;
    source: string;
    created_at: string | Date;
  }>(
    `SELECT "offset", "type", payload, "source", created_at FROM event_log WHERE branch_id = $1 ORDER BY "offset" ASC`,
    [branchId]
  );

  if (ownEventRows.length === 0) {
    return { success: true, promotedCount: 0 };
  }

  const branchEvents: EventLogEntry[] = ownEventRows.map((r) => ({
    offset: Number(r.offset),
    branch_id: branchId,
    type: r.type as EventType,
    payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
    source: r.source,
    created_at: r.created_at,
  }));

  // 3. Compute affected keys for all events being promoted
  const baseParentEvents = await readBranchEventsWithAncestry(
    pool,
    branch.forked_from_branch || intoBranchId,
    forkOffset
  );
  let simPlan = replayEvents(baseParentEvents);
  const branchAffectedKeys = new Set<string>();

  for (const ev of branchEvents) {
    const keys = computeAffectedKeys(ev, simPlan);
    keys.forEach((k) => branchAffectedKeys.add(k));
    simPlan = replayEvents([ev], undefined, simPlan);
  }

  // 4. Fetch events gained by the target branch since fork_offset
  const { rows: targetNewRows } = await pool.query<{
    offset: string | number;
    type: string;
    payload: any;
    source: string;
    created_at: string | Date;
  }>(
    `SELECT "offset", "type", payload, "source", created_at FROM event_log WHERE branch_id = $1 AND "offset" > $2 ORDER BY "offset" ASC`,
    [intoBranchId, forkOffset]
  );

  if (targetNewRows.length > 0) {
    let targetSimPlan = replayEvents(baseParentEvents);
    const targetAffectedKeys = new Set<string>();

    for (const r of targetNewRows) {
      const targetEv: EventLogEntry = {
        offset: Number(r.offset),
        branch_id: intoBranchId,
        type: r.type as EventType,
        payload:
          typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        source: r.source,
        created_at: r.created_at,
      };
      const keys = computeAffectedKeys(targetEv, targetSimPlan);
      keys.forEach((k) => targetAffectedKeys.add(k));
      targetSimPlan = replayEvents([targetEv], undefined, targetSimPlan);
    }

    // Check for resource collision
    const conflictingKeys: string[] = [];
    for (const k of branchAffectedKeys) {
      if (targetAffectedKeys.has(k)) {
        conflictingKeys.push(k);
      }
    }

    if (conflictingKeys.length > 0) {
      throw new Error(
        `Cannot promote branch '${branchId}' into '${intoBranchId}': target branch has concurrent modifications on the same resources: ${conflictingKeys.join(
          ", "
        )}`
      );
    }
  }

  // 5. Append each event onto the target branch via the standard transactional path
  for (const ev of branchEvents) {
    await appendEventWithDeltas({
      branchId: intoBranchId,
      type: ev.type,
      payload: ev.payload,
      source: "promoted",
      createdAt: ev.created_at,
    });
  }

  return {
    success: true,
    promotedCount: branchEvents.length,
  };
}
