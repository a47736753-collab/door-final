import type { EventPlan, ReadinessIssue } from "../client/src/features/doorsopen/types";
import { runChecks, severityWeight } from "../client/src/features/doorsopen/checks";

export interface IncrementalCheckResult {
  issues: ReadinessIssue[];
  recheckCounts: {
    rechecked: number;
    total: number;
  };
}

/**
 * Pure incremental checker:
 * - Identifies all sessions and tasks connected to the affected keys.
 * - Transitively expands to all partner sessions in the connected collision component (fixed-point).
 * - Keeps previous open issues that do not touch the rechecked scope.
 * - Re-runs runChecks on the connected sub-plan.
 * - Merges and deduplicates the results, preserving any extraIssues passed in.
 * - Returns accurate recheck counts: sessions and tasks re-evaluated vs total.
 */
export function runIncrementalChecks(
  previousIssues: ReadinessIssue[],
  newPlan: EventPlan,
  affectedKeys: Set<string>,
  now: Date = new Date(),
  extraIssues: ReadinessIssue[] = []
): IncrementalCheckResult {
  const total = newPlan.sessions.length + newPlan.tasks.length;

  // If nothing was affected, retain previous issues + extraIssues
  if (affectedKeys.size === 0) {
    const map = new Map<string, ReadinessIssue>();
    for (const issue of previousIssues) map.set(issue.id, issue);
    for (const issue of extraIssues) map.set(issue.id, issue);
    const sorted = Array.from(map.values()).sort(
      (a, b) =>
        severityWeight(b.severity) - severityWeight(a.severity) ||
        a.title.localeCompare(b.title)
    );
    return {
      issues: sorted,
      recheckCounts: { rechecked: 0, total },
    };
  }

  // 1. Initial connected sessions from affectedKeys
  const connectedSet = new Set<string>();
  for (const s of newPlan.sessions) {
    if (
      affectedKeys.has(`session:${s.id}`) ||
      affectedKeys.has(`venue:${s.venueId}`) ||
      s.volunteerIds?.some((v) => affectedKeys.has(`volunteer:${v}`)) ||
      s.equipmentIds?.some((e) => affectedKeys.has(`equipment:${e}`))
    ) {
      connectedSet.add(s.id);
    }
  }

  // 2. Transitive expansion to partner collision sessions until fixed point
  // Ensures any session that shares room, volunteer, or equipment with ANY rechecked session is in subPlan
  let prevSize = 0;
  while (connectedSet.size > prevSize && connectedSet.size < newPlan.sessions.length) {
    prevSize = connectedSet.size;
    const partnerVenues = new Set<string>();
    const partnerVolunteers = new Set<string>();
    const partnerEquipment = new Set<string>();

    for (const s of newPlan.sessions) {
      if (connectedSet.has(s.id)) {
        partnerVenues.add(s.venueId);
        s.volunteerIds?.forEach((v) => partnerVolunteers.add(v));
        s.equipmentIds?.forEach((e) => partnerEquipment.add(e));
      }
    }

    for (const s of newPlan.sessions) {
      if (
        partnerVenues.has(s.venueId) ||
        s.volunteerIds?.some((v) => partnerVolunteers.has(v)) ||
        s.equipmentIds?.some((e) => partnerEquipment.has(e))
      ) {
        connectedSet.add(s.id);
      }
    }
  }

  const recheckedSessions = newPlan.sessions.filter((s) => connectedSet.has(s.id));

  // 3. Tasks connected to affectedKeys
  const recheckedTasks = newPlan.tasks.filter(
    (t) =>
      affectedKeys.has(`task:${t.id}`) ||
      (t.venueId && affectedKeys.has(`venue:${t.venueId}`))
  );

  const rechecked = recheckedSessions.length + recheckedTasks.length;

  // Build the set of rechecked resource keys
  const recheckedKeys = new Set(affectedKeys);
  recheckedSessions.forEach((s) => recheckedKeys.add(`session:${s.id}`));
  recheckedTasks.forEach((t) => recheckedKeys.add(`task:${t.id}`));

  // Keep previous issues whose links do not touch any rechecked keys
  const keptIssues = previousIssues.filter(
    (issue) =>
      !issue.links.some((link) => recheckedKeys.has(`${link.kind}:${link.id}`))
  );

  // 4. Run checks on the isolated connected sub-plan
  let newIssues: ReadinessIssue[] = [];
  if (recheckedSessions.length > 0 || recheckedTasks.length > 0) {
    const subPlan: EventPlan = {
      event: newPlan.event,
      venues: newPlan.venues,
      sessions: recheckedSessions,
      volunteers: newPlan.volunteers,
      equipment: newPlan.equipment,
      tasks: recheckedTasks,
    };
    newIssues = runChecks(subPlan, now);
  }

  // 5. Merge: kept issues + newly generated issues + extra issues
  const allIssuesMap = new Map<string, ReadinessIssue>();
  for (const issue of keptIssues) {
    allIssuesMap.set(issue.id, issue);
  }
  for (const issue of newIssues) {
    allIssuesMap.set(issue.id, issue);
  }
  for (const issue of extraIssues) {
    allIssuesMap.set(issue.id, issue);
  }

  // 6. Tie-breaker matching runChecks:
  // - severity descending
  // - title ascending
  // - session pair order (idx1, idx2) in newPlan matching the nested sessions loop in runChecks
  // - issue ID
  const sessionOrder = new Map(newPlan.sessions.map((s, idx) => [s.id, idx]));
  const getIssuePairOrder = (issue: ReadinessIssue): [number, number] => {
    const sLinks = issue.links
      .filter((l) => l.kind === "session")
      .map((l) => sessionOrder.get(l.id) ?? 999999)
      .sort((a, b) => a - b);
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
      total,
    },
  };
}
