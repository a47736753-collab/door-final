import type { EventPlan, Session, Equipment, ReadinessTask, Venue, Volunteer } from "../client/src/features/doorsopen/types";

export type EventType =
  | "PlanImported"
  | "SessionMoved"
  | "SessionTimeChanged"
  | "VolunteerAssigned"
  | "EquipmentAssigned"
  | "EquipmentStatusChanged"
  | "TaskCompleted"
  | "ConfirmationAccepted"
  | "ConfirmationRejected"
  | "StaleConfirmationFlagged";

export interface PlanImportedPayload {
  plan: EventPlan;
  rowMap?: Record<string, number>;
}

export interface SessionMovedPayload {
  sessionId: string;
  venueId: string;
}

export interface SessionTimeChangedPayload {
  sessionId: string;
  start: string;
  end: string;
  dayOffset?: number;
}

export interface VolunteerAssignedPayload {
  sessionId: string;
  volunteerId: string;
  assigned?: boolean;
}

export interface EquipmentAssignedPayload {
  sessionId: string;
  equipmentId: string;
  assigned?: boolean;
}

export interface EquipmentStatusChangedPayload {
  equipmentId: string;
  status: "ready" | "needs-check";
}

export interface TaskCompletedPayload {
  taskId: string;
  completed: boolean;
}

export interface ConfirmationAcceptedPayload {
  volunteerId: string;
  sessionId: string;
  basedOnOffset: number;
  seq: number;
  status: string;
}

export interface ConfirmationRejectedPayload {
  volunteerId: string;
  sessionId: string;
  basedOnOffset: number;
  seq: number;
  status: string;
  reason: string;
}

export interface StaleConfirmationFlaggedPayload {
  volunteerId: string;
  sessionId: string;
  basedOnOffset: number;
  seq: number;
  status: string;
  reason: string;
}

export type EventPayloadMap = {
  PlanImported: PlanImportedPayload;
  SessionMoved: SessionMovedPayload;
  SessionTimeChanged: SessionTimeChangedPayload;
  VolunteerAssigned: VolunteerAssignedPayload;
  EquipmentAssigned: EquipmentAssignedPayload;
  EquipmentStatusChanged: EquipmentStatusChangedPayload;
  TaskCompleted: TaskCompletedPayload;
  ConfirmationAccepted: ConfirmationAcceptedPayload;
  ConfirmationRejected: ConfirmationRejectedPayload;
  StaleConfirmationFlagged: StaleConfirmationFlaggedPayload;
};

export interface EventLogEntry<T extends EventType = EventType> {
  offset: number | string;
  branch_id?: string;
  type: T;
  payload: EventPayloadMap[T] | Record<string, any>;
  source?: string;
  created_at?: string | Date;
}

export function createEmptyPlan(): EventPlan {
  return {
    event: {
      id: "event-init",
      name: "New Event",
      subtitle: "",
      date: new Date().toISOString(),
      venueName: "",
      isSample: false,
    },
    venues: [],
    sessions: [],
    volunteers: [],
    equipment: [],
    tasks: [],
  };
}

/**
 * Pure function that rebuilds the EventPlan by replaying events up to an optional given offset.
 * Fully deterministic; does not access the database or external state.
 */
export function replayEvents(
  events: EventLogEntry[],
  upToOffset?: number,
  basePlan?: EventPlan
): EventPlan {
  const plan: EventPlan = basePlan
    ? JSON.parse(JSON.stringify(basePlan))
    : createEmptyPlan();

  const filtered = (upToOffset !== undefined
    ? events.filter((e) => Number(e.offset) <= upToOffset)
    : events.slice()
  ).sort((a, b) => Number(a.offset) - Number(b.offset));

  for (const event of filtered) {
    const payload = event.payload as any;

    switch (event.type) {
      case "PlanImported": {
        const imported = payload.plan as EventPlan;
        if (imported) {
          const next = JSON.parse(JSON.stringify(imported)) as EventPlan;
          if (payload.rowMap) {
            const rowMap = payload.rowMap as Record<string, number>;
            if (next.event && rowMap[next.event.id] !== undefined) {
              next.event.csvRow = rowMap[next.event.id];
            }
            next.venues.forEach((v) => {
              if (rowMap[v.id] !== undefined) v.csvRow = rowMap[v.id];
            });
            next.sessions.forEach((s) => {
              if (rowMap[s.id] !== undefined) s.csvRow = rowMap[s.id];
            });
            next.volunteers.forEach((v) => {
              if (rowMap[v.id] !== undefined) v.csvRow = rowMap[v.id];
            });
            next.equipment.forEach((e) => {
              if (rowMap[e.id] !== undefined) e.csvRow = rowMap[e.id];
            });
            next.tasks.forEach((t) => {
              if (rowMap[t.id] !== undefined) t.csvRow = rowMap[t.id];
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
          if (payload.dayOffset !== undefined) {
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
        const task = plan.tasks.find((t) => t.id === payload.taskId);
        if (task) {
          task.completed = payload.completed;
        }
        break;
      }

      case "ConfirmationAccepted": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          (session as any).confirmations = (session as any).confirmations || {};
          (session as any).confirmations[payload.volunteerId] = {
            status: payload.status,
            basedOnOffset: payload.basedOnOffset,
            seq: payload.seq,
          };
        }
        break;
      }

      case "ConfirmationRejected": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          (session as any).confirmations = (session as any).confirmations || {};
          (session as any).confirmations[payload.volunteerId] = {
            status: payload.status,
            basedOnOffset: payload.basedOnOffset,
            seq: payload.seq,
            reason: payload.reason,
          };
        }
        break;
      }

      case "StaleConfirmationFlagged": {
        const session = plan.sessions.find((s) => s.id === payload.sessionId);
        if (session) {
          (session as any).confirmations = (session as any).confirmations || {};
          (session as any).confirmations[payload.volunteerId] = {
            status: payload.status,
            basedOnOffset: payload.basedOnOffset,
            seq: payload.seq,
            reason: payload.reason,
          };
        }
        break;
      }
    }
  }

  return plan;
}
