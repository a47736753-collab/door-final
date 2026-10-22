import type { EventLogEntry } from "../../../../server/events";
import type { EventPlan } from "../doorsopen/types";

/** Events that only record a confirmation do not change the plan, so they never make anyone stale. */
const NON_PLAN_EVENTS = new Set(["ConfirmationAccepted", "ConfirmationRejected", "StaleConfirmationFlagged", "TaskCompleted"]);

/** The newest offset in the log (0 when the log is empty). */
export function latestLogOffset(events: readonly Pick<EventLogEntry, "offset">[]): number {
  let latest = 0;
  for (const event of events) latest = Math.max(latest, Number(event.offset) || 0);
  return latest;
}

/**
 * For every session in `plan`, the offset of the last log event that changed that session
 * or something it uses (its volunteers, its equipment). 0 means "never changed".
 *
 *  PlanImported                       changes every session
 *  SessionMoved / SessionTimeChanged  changes that session
 *  VolunteerAssigned / EquipmentAssigned  changes that session
 *  EquipmentStatusChanged             changes every session that uses that equipment
 */
export function sessionOffsets(
  events: readonly Pick<EventLogEntry, "offset" | "type" | "payload">[],
  plan: EventPlan,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const session of plan.sessions) result[session.id] = 0;

  const bump = (sessionId: string, offset: number) => {
    if (sessionId in result) result[sessionId] = Math.max(result[sessionId], offset);
  };

  for (const event of events) {
    const offset = Number(event.offset) || 0;
    if (NON_PLAN_EVENTS.has(event.type)) continue;
    const payload = (event.payload ?? {}) as Record<string, unknown>;

    switch (event.type) {
      case "PlanImported":
        for (const session of plan.sessions) bump(session.id, offset);
        break;
      case "SessionMoved":
      case "SessionTimeChanged":
      case "VolunteerAssigned":
      case "EquipmentAssigned":
        if (typeof payload.sessionId === "string") bump(payload.sessionId, offset);
        break;
      case "EquipmentStatusChanged":
        for (const session of plan.sessions) {
          if (session.equipmentIds?.includes(payload.equipmentId as string)) bump(session.id, offset);
        }
        break;
    }
  }
  return result;
}
