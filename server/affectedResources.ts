import type { EventPlan, Session } from "../client/src/features/doorsopen/types";
import type { EventLogEntry, EventType } from "./events";

/**
 * Pure function that computes the set of affected resource keys for an event,
 * given the state of the plan before the event occurred.
 *
 * Keys format:
 * - session:<id>
 * - venue:<id>
 * - volunteer:<id>
 * - equipment:<id>
 * - task:<id>
 * - event:<id>
 */
export function computeAffectedKeys(
  event: EventLogEntry,
  planBefore: EventPlan
): Set<string> {
  const affected = new Set<string>();
  const payload = event.payload as any;

  switch (event.type as EventType) {
    case "PlanImported": {
      // Plan import affects all resources in the new plan and old plan
      if (planBefore.event?.id) affected.add(`event:${planBefore.event.id}`);
      planBefore.venues.forEach((v) => affected.add(`venue:${v.id}`));
      planBefore.sessions.forEach((s) => affected.add(`session:${s.id}`));
      planBefore.volunteers.forEach((v) => affected.add(`volunteer:${v.id}`));
      planBefore.equipment.forEach((e) => affected.add(`equipment:${e.id}`));
      planBefore.tasks.forEach((t) => affected.add(`task:${t.id}`));

      const importedPlan = payload?.plan as EventPlan | undefined;
      if (importedPlan) {
        if (importedPlan.event?.id) affected.add(`event:${importedPlan.event.id}`);
        importedPlan.venues?.forEach((v) => affected.add(`venue:${v.id}`));
        importedPlan.sessions?.forEach((s) => affected.add(`session:${s.id}`));
        importedPlan.volunteers?.forEach((v) => affected.add(`volunteer:${v.id}`));
        importedPlan.equipment?.forEach((e) => affected.add(`equipment:${e.id}`));
        importedPlan.tasks?.forEach((t) => affected.add(`task:${t.id}`));
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

      // Moving a session also affects its assigned volunteers and equipment
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

      // Any session currently using this equipment is affected
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
        const task = planBefore.tasks.find((t) => t.id === payload.taskId);
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
