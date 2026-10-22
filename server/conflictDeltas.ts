import type { Pool, PoolClient } from "pg";
import type { EventPlan, ReadinessIssue } from "../client/src/features/doorsopen/types";
import { severityWeight } from "../client/src/features/doorsopen/checks";
import { requirePool, getPool } from "./db";
import { replayEvents, type EventLogEntry, type EventType } from "./events";
import { computeAffectedKeys } from "./affectedResources";
import { runIncrementalChecks, type IncrementalCheckResult } from "./incrementalChecker";

export interface ConflictDeltaRecord {
  id?: number | string;
  branch_id: string;
  offset: number;
  issue_id: string;
  op: "opened" | "resolved";
  payload: ReadinessIssue | null;
  created_at?: string | Date;
}

export interface DeltaComputationResult {
  opened: ReadinessIssue[];
  resolved: ReadinessIssue[];
}

export interface AppendEventWithDeltasParams {
  branchId?: string;
  type: string;
  payload: any;
  source?: string;
  createdAt?: string | Date;
  now?: Date;
  extraIssues?: ReadinessIssue[];
}

export interface AppendEventWithDeltasResult {
  offset: number;
  branchId: string;
  type: string;
  payload: any;
  source: string;
  createdAt: string | Date;
  issueChanges: DeltaComputationResult;
  recheckCounts: {
    rechecked: number;
    total: number;
  };
}

export interface BranchSegment {
  branchId: string;
  maxOffset?: number;
}

/**
 * Pure function: compares previous issues and new issues by issue ID.
 */
export function computeDeltas(
  previousIssues: ReadinessIssue[],
  newIssues: ReadinessIssue[]
): DeltaComputationResult {
  const previousMap = new Map(previousIssues.map((i) => [i.id, i]));
  const newMap = new Map(newIssues.map((i) => [i.id, i]));

  const opened = newIssues.filter((i) => !previousMap.has(i.id));
  const resolved = previousIssues.filter((i) => !newMap.has(i.id));

  return { opened, resolved };
}

/**
 * Pure function: replays a sequence of conflict deltas in chronological order
 * and returns the open issues, sorted identically to runChecks.
 */
export function replayDeltas(
  deltas: Array<{ issue_id: string; op: "opened" | "resolved"; payload?: any }>
): ReadinessIssue[] {
  const openMap = new Map<string, ReadinessIssue>();

  for (const delta of deltas) {
    if (delta.op === "opened") {
      if (delta.payload) {
        const issue =
          typeof delta.payload === "string"
            ? (JSON.parse(delta.payload) as ReadinessIssue)
            : (delta.payload as ReadinessIssue);
        openMap.set(delta.issue_id, issue);
      }
    } else if (delta.op === "resolved") {
      openMap.delete(delta.issue_id);
    }
  }

  return Array.from(openMap.values()).sort(
    (a, b) =>
      severityWeight(b.severity) - severityWeight(a.severity) ||
      a.title.localeCompare(b.title)
  );
}

type BranchRow = {
  id: string;
  forked_from_branch: string | null;
  fork_offset: string | number | null;
};

/**
 * Resolves the ancestry chain for a branch.
 * Returns segments ordered from root ancestor to the given branch.
 */
export async function getBranchAncestrySegments(
  clientOrPool: Pool | PoolClient,
  branchId: string,
  targetOffset?: number
): Promise<BranchSegment[]> {
  const segments: BranchSegment[] = [];
  let currentId: string | null = branchId;
  let currentMax: number | undefined = targetOffset;

  while (currentId) {
    const res = await clientOrPool.query<BranchRow>(
      `SELECT id, forked_from_branch, fork_offset FROM branches WHERE id = $1`,
      [currentId]
    );
    const rows: BranchRow[] = res.rows;

    if (rows.length === 0) {
      // Branch not found in DB; record segment and stop
      segments.push({ branchId: currentId, maxOffset: currentMax });
      break;
    }

    const row: BranchRow = rows[0];
    segments.push({ branchId: row.id, maxOffset: currentMax });

    if (row.forked_from_branch && row.fork_offset != null) {
      const forkOffset = Number(row.fork_offset);
      // Ancestor only contributes up to fork_offset (or currentMax if smaller)
      currentMax =
        currentMax !== undefined ? Math.min(currentMax, forkOffset) : forkOffset;
      currentId = row.forked_from_branch;
    } else {
      currentId = null;
    }
  }

  // Reverse so we evaluate root ancestor first, down to child
  return segments.reverse();
}

/**
 * Reads all events for a branch, taking ancestry into account.
 */
export async function readBranchEventsWithAncestry(
  clientOrPool: Pool | PoolClient,
  branchId: string,
  targetOffset?: number
): Promise<EventLogEntry[]> {
  const segments = await getBranchAncestrySegments(
    clientOrPool,
    branchId,
    targetOffset
  );
  const allEvents: EventLogEntry[] = [];

  for (const seg of segments) {
    const values: any[] = [seg.branchId];
    let query = `
      SELECT "offset", branch_id, "type", payload, "source", created_at
      FROM event_log
      WHERE branch_id = $1
    `;

    if (seg.maxOffset !== undefined) {
      values.push(seg.maxOffset);
      query += ` AND "offset" <= $${values.length}`;
    }

    query += ` ORDER BY "offset" ASC`;

    const { rows } = await clientOrPool.query(query, values);
    for (const r of rows) {
      allEvents.push({
        offset: Number(r.offset),
        branch_id: r.branch_id,
        type: r.type as EventType,
        payload:
          typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        source: r.source,
        created_at: r.created_at,
      });
    }
  }

  return allEvents;
}

/**
 * Reads all conflict deltas for a branch, taking ancestry into account.
 */
export async function readBranchDeltasWithAncestry(
  clientOrPool: Pool | PoolClient,
  branchId: string,
  targetOffset?: number
): Promise<Array<{ issue_id: string; op: "opened" | "resolved"; payload: any; offset: number }>> {
  const segments = await getBranchAncestrySegments(
    clientOrPool,
    branchId,
    targetOffset
  );
  const allDeltas: Array<{
    issue_id: string;
    op: "opened" | "resolved";
    payload: any;
    offset: number;
  }> = [];

  for (const seg of segments) {
    const values: any[] = [seg.branchId];
    let query = `
      SELECT id, branch_id, "offset", issue_id, op, payload, created_at
      FROM conflict_deltas
      WHERE branch_id = $1
    `;

    if (seg.maxOffset !== undefined) {
      values.push(seg.maxOffset);
      query += ` AND "offset" <= $${values.length}`;
    }

    query += ` ORDER BY "offset" ASC, id ASC`;

    const { rows } = await clientOrPool.query(query, values);
    for (const r of rows) {
      allDeltas.push({
        issue_id: r.issue_id,
        op: r.op as "opened" | "resolved",
        payload:
          typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
        offset: Number(r.offset),
      });
    }
  }

  return allDeltas;
}

/**
 * Replays conflict deltas up to offset, respecting branch ancestry.
 */
export async function conflictSetAt(
  branchId: string,
  offset?: number,
  clientOrPool?: Pool | PoolClient
): Promise<ReadinessIssue[]> {
  const executor = clientOrPool || requirePool();
  const deltas = await readBranchDeltasWithAncestry(executor, branchId, offset);
  return replayDeltas(deltas);
}

/**
 * Appends an event to the event log and writes its computed conflict deltas
 * to conflict_deltas within the SAME database transaction.
 *
 * Acquires a row lock on the branch (`SELECT ... FOR UPDATE`) so concurrent
 * appends cannot compute deltas from stale state.
 */
export async function appendEventWithDeltas(
  params: AppendEventWithDeltasParams
): Promise<AppendEventWithDeltasResult> {
  const pool = requirePool();
  const client = await pool.connect();
  const branchId = params.branchId || "main";

  try {
    await client.query("BEGIN");

    // 1. Lock the branch row to serialize concurrent appends on this branch
    const branchRes = await client.query(
      `SELECT id, name, forked_from_branch, fork_offset FROM branches WHERE id = $1 FOR UPDATE`,
      [branchId]
    );

    if (branchRes.rows.length === 0) {
      throw new Error(`Branch '${branchId}' does not exist.`);
    }

    // 2. Read previous events & deltas up to current state within transaction
    const previousEvents = await readBranchEventsWithAncestry(client, branchId);
    const planBefore = replayEvents(previousEvents);

    const previousDeltas = await readBranchDeltasWithAncestry(client, branchId);
    const previousIssues = replayDeltas(previousDeltas);

    // 3. Determine event date/time
    const eventDate = params.createdAt
      ? new Date(params.createdAt)
      : params.now
      ? new Date(params.now)
      : new Date();

    const newEvent: EventLogEntry = {
      offset: 0, // offset assigned by DB
      branch_id: branchId,
      type: params.type as EventType,
      payload: params.payload ?? {},
      source: params.source || "api",
      created_at: eventDate,
    };

    // 4. Compute affected keys and incremental check
    const affectedKeys = computeAffectedKeys(newEvent, planBefore);
    const newPlan = replayEvents([newEvent], undefined, planBefore);
    const checkResult = runIncrementalChecks(
      previousIssues,
      newPlan,
      affectedKeys,
      eventDate,
      params.extraIssues
    );

    // 5. Compute opened and resolved deltas
    const issueChanges = computeDeltas(previousIssues, checkResult.issues);

    // 6. Insert event into event_log
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
        eventDate,
      ]
    );

    const insertedOffset = Number(eventRows[0].offset);

    // 7. Batch insert conflict deltas into conflict_deltas in a single query
    const allDeltasToInsert = [
      ...issueChanges.opened.map((i) => ({ issue: i, op: "opened" as const })),
      ...issueChanges.resolved.map((i) => ({ issue: i, op: "resolved" as const })),
    ];

    if (allDeltasToInsert.length > 0) {
      const values: any[] = [];
      const valueClauses: string[] = [];

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
      recheckCounts: checkResult.recheckCounts,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
