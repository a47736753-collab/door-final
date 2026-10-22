import type {
  EntityKind,
  EventPlan,
  LinkedEntity,
  ReadinessIssue,
  ReadinessTask,
  Session,
  Severity,
} from "./types";
import { timeToMinutes } from "./types";

function overlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  return Number.isFinite(as) && Number.isFinite(ae) && Number.isFinite(bs) && Number.isFinite(be) && as < be && bs < ae;
}

function entity(id: string, kind: EntityKind, label: string): LinkedEntity {
  return { id, kind, label };
}

function sessionLink(session: Session, plan: EventPlan): LinkedEntity {
  const venue = plan.venues.find((item) => item.id === session.venueId);
  return entity(session.id, "session", session.title + (venue ? ` · ${venue.name}` : ""));
}

function taskSeverity(task: ReadinessTask, now: Date): Severity {
  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return "critical";
  if (task.priority === "high" || due.getTime() - now.getTime() < 48 * 60 * 60 * 1000) return "warning";
  return "info";
}

export function runChecks(plan: EventPlan, now = new Date()): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];
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
        links: [sessionLink(current, plan)],
      });
    } else if (current.expectedAttendance > venue.capacity) {
      issues.push({
        id: `capacity:${current.id}`,
        kind: "capacity",
        severity: "critical",
        title: `${venue.name} exceeds capacity`,
        explanation: `${current.title} expects ${current.expectedAttendance} attendees, above ${venue.name}'s capacity of ${venue.capacity}.`,
        recommendation: "Move the session to a venue with enough capacity or reduce the expected attendance.",
        links: [sessionLink(current, plan), entity(venue.id, "venue", venue.name)],
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
        explanation: `The entered time range ${current.start}–${current.end} is not a valid same-day interval.`,
        recommendation: "Enter a valid start and end time; the end must be after the start.",
        links: [sessionLink(current, plan)],
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
          explanation: `${current.title} and ${other.title} overlap from ${current.start}–${current.end} in ${roomName}.`,
          recommendation: "Move one activity to an available venue or adjust its time, then rerun the connected checks.",
          links: [sessionLink(current, plan), sessionLink(other, plan), ...(venue ? [entity(venue.id, "venue", venue.name)] : [])],
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
          links: [sessionLink(current, plan)],
        });
        continue;
      }

      if (timeToMinutes(current.start) < timeToMinutes(volunteer.availableFrom) || timeToMinutes(current.end) > timeToMinutes(volunteer.availableTo)) {
        issues.push({
          id: `volunteer:availability:${current.id}:${volunteer.id}`,
          kind: "volunteer",
          severity: "warning",
          title: `${volunteer.name} is outside their available hours`,
          explanation: `${current.title} runs ${current.start}–${current.end}, but ${volunteer.name} is available ${volunteer.availableFrom}–${volunteer.availableTo}.`,
          recommendation: "Confirm availability or reassign this activity to another volunteer.",
          links: [sessionLink(current, plan), entity(volunteer.id, "volunteer", volunteer.name)],
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
            links: [sessionLink(current, plan), sessionLink(other, plan), entity(volunteer.id, "volunteer", volunteer.name)],
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
          links: [sessionLink(current, plan)],
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
          links: [sessionLink(current, plan), entity(item.id, "equipment", item.name)],
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
            links: [sessionLink(current, plan), sessionLink(other, plan), entity(item.id, "equipment", item.name)],
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
      links: [entity(task.id, "task", task.title), ...(task.venueId && venueById.get(task.venueId) ? [entity(task.venueId, "venue", venueById.get(task.venueId)!.name)] : [])],
    });
  }

  return issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title));
}

export function severityWeight(severity: Severity): number {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
}

export function readinessScore(issues: ReadinessIssue[]): number {
  if (issues.length === 0) return 100;
  const deduction = issues.reduce((total, issue) => total + (issue.severity === "critical" ? 14 : issue.severity === "warning" ? 7 : 3), 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction)));
}

export function priorityScore(issues: ReadinessIssue[], issue: ReadinessIssue, daysUntilEvent: number): number {
  const impact = severityWeight(issue.severity) * 28;
  const proximity = Math.max(0, 30 - Math.max(0, daysUntilEvent) * 2);
  const frequency = Math.min(12, issue.links.length * 3);
  const related = issues.filter((item) => item.kind === issue.kind && item.severity === issue.severity).length;
  return Math.round(impact + proximity + frequency + related);
}

export function simulatePlan(original: EventPlan, proposed: EventPlan) {
  const before = runChecks(original);
  const after = runChecks(proposed);
  const beforeIds = new Set(before.map((item) => item.id));
  const afterIds = new Set(after.map((item) => item.id));
  return {
    before,
    after,
    resolved: before.filter((item) => !afterIds.has(item.id)),
    remaining: after.filter((item) => beforeIds.has(item.id)),
    introduced: after.filter((item) => !beforeIds.has(item.id)),
  };
}
