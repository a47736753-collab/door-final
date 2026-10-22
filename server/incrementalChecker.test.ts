import { describe, expect, it } from "vitest";
import { demoPlan } from "../client/src/features/doorsopen/demo-data";
import { runChecks, severityWeight } from "../client/src/features/doorsopen/checks";
import type { EventPlan, ReadinessIssue } from "../client/src/features/doorsopen/types";
import { computeAffectedKeys } from "./affectedResources";
import { runIncrementalChecks } from "./incrementalChecker";
import { computeDeltas, replayDeltas } from "./conflictDeltas";
import { replayEvents, type EventLogEntry } from "./events";

const FIXED_NOW = new Date("2026-11-15T12:00:00.000Z");

describe("Affected Resources Analysis", () => {
  it("computes affected keys for SessionMoved including session, old & new rooms, volunteers, and equipment", () => {
    const session = demoPlan.sessions.find((s) => s.id === "session-robotics")!;
    expect(session).toBeDefined();

    const event: EventLogEntry<"SessionMoved"> = {
      offset: 1,
      type: "SessionMoved",
      payload: {
        sessionId: "session-robotics",
        venueId: "venue-room-c",
      },
    };

    const keys = computeAffectedKeys(event, demoPlan);
    expect(keys.has("session:session-robotics")).toBe(true);
    expect(keys.has("venue:venue-room-a")).toBe(true); // old venue
    expect(keys.has("venue:venue-room-c")).toBe(true); // new venue

    session.volunteerIds.forEach((vId) => {
      expect(keys.has(`volunteer:${vId}`)).toBe(true);
    });
    session.equipmentIds.forEach((eId) => {
      expect(keys.has(`equipment:${eId}`)).toBe(true);
    });
  });

  it("computes affected keys for EquipmentStatusChanged including sessions using the equipment", () => {
    const event: EventLogEntry<"EquipmentStatusChanged"> = {
      offset: 2,
      type: "EquipmentStatusChanged",
      payload: {
        equipmentId: "equipment-p1",
        status: "needs-check",
      },
    };

    const keys = computeAffectedKeys(event, demoPlan);
    expect(keys.has("equipment:equipment-p1")).toBe(true);

    const sessionsWithProjector = demoPlan.sessions.filter((s) =>
      s.equipmentIds.includes("equipment-p1")
    );
    expect(sessionsWithProjector.length).toBeGreaterThan(0);
    sessionsWithProjector.forEach((s) => {
      expect(keys.has(`session:${s.id}`)).toBe(true);
    });
  });
});

describe("Incremental Conflict Checker", () => {
  it("resolves the Room A collision after moving Robotics to Room C, but keeps projector P1 double-booked", () => {
    const beforeIssues = runChecks(demoPlan, FIXED_NOW);

    const originalRoomConflict = beforeIssues.find(
      (issue) =>
        issue.kind === "room" &&
        issue.links.some((link) => link.id === "session-robotics")
    );
    const projectorIssue = beforeIssues.find(
      (issue) =>
        issue.kind === "equipment" &&
        issue.title.includes("Projector P1") &&
        issue.title.includes("double-booked")
    );

    expect(originalRoomConflict).toBeDefined();
    expect(projectorIssue).toBeDefined();

    const moveEvent: EventLogEntry<"SessionMoved"> = {
      offset: 1,
      type: "SessionMoved",
      payload: {
        sessionId: "session-robotics",
        venueId: "venue-room-c",
      },
    };

    const affectedKeys = computeAffectedKeys(moveEvent, demoPlan);
    const newPlan = replayEvents([moveEvent], undefined, demoPlan);

    const { issues: afterIssues, recheckCounts } = runIncrementalChecks(
      beforeIssues,
      newPlan,
      affectedKeys,
      FIXED_NOW
    );

    // 1. Room conflict resolved
    expect(
      afterIssues.some((issue) => issue.id === originalRoomConflict!.id)
    ).toBe(false);

    // 2. Projector P1 double-booked issue remains
    expect(
      afterIssues.some((issue) => issue.id === projectorIssue!.id)
    ).toBe(true);

    // 3. Re-check counts: only connected sessions and tasks were rechecked
    expect(recheckCounts.rechecked).toBeGreaterThan(0);
    expect(recheckCounts.rechecked).toBeLessThan(recheckCounts.total);
    expect(recheckCounts.total).toBe(
      newPlan.sessions.length + newPlan.tasks.length
    );

    // 4. Matches full runChecks exactly in IDs, contents, and sort order
    const fullExpected = runChecks(newPlan, FIXED_NOW);
    expect(afterIssues.map((i) => i.id)).toEqual(fullExpected.map((i) => i.id));
    expect(afterIssues).toEqual(fullExpected);
  });

  it("preserves extraIssues (such as stale-confirmation issues) without dropping them", () => {
    const mockStaleIssue: ReadinessIssue = {
      id: "stale:volunteer-test",
      kind: "stale",
      severity: "warning",
      title: "Stale Volunteer Confirmation",
      explanation: "Volunteer confirmed prior schedule offset",
      recommendation: "Request re-confirmation",
      links: [{ id: "session-robotics", kind: "session", label: "Robotics" }],
    };

    const beforeIssues = runChecks(demoPlan, FIXED_NOW);
    const moveEvent: EventLogEntry<"SessionMoved"> = {
      offset: 1,
      type: "SessionMoved",
      payload: {
        sessionId: "session-robotics",
        venueId: "venue-room-c",
      },
    };
    const affected = computeAffectedKeys(moveEvent, demoPlan);
    const newPlan = replayEvents([moveEvent], undefined, demoPlan);

    const result = runIncrementalChecks(
      beforeIssues,
      newPlan,
      affected,
      FIXED_NOW,
      [mockStaleIssue]
    );

    expect(result.issues.some((i) => i.id === "stale:volunteer-test")).toBe(true);
  });
});

describe("Correctness Proof (Randomized Event Sequences)", () => {
  it("proves incremental checks equal full runChecks across an extensive sequence of random events", () => {
    let currentPlan: EventPlan = JSON.parse(JSON.stringify(demoPlan));
    let currentIssues = runChecks(currentPlan, FIXED_NOW);

    const availableVenueIds = currentPlan.venues.map((v) => v.id);
    const availableVolunteerIds = currentPlan.volunteers.map((v) => v.id);
    const availableEquipmentIds = currentPlan.equipment.map((e) => e.id);

    const operations: Array<() => EventLogEntry> = [
      // Move a random session
      () => {
        const s =
          currentPlan.sessions[
            Math.floor(Math.random() * currentPlan.sessions.length)
          ];
        const vId =
          availableVenueIds[
            Math.floor(Math.random() * availableVenueIds.length)
          ];
        return {
          offset: 1,
          type: "SessionMoved",
          payload: { sessionId: s.id, venueId: vId },
        };
      },
      // Change time of a random session
      () => {
        const s =
          currentPlan.sessions[
            Math.floor(Math.random() * currentPlan.sessions.length)
          ];
        const startHours = 9 + Math.floor(Math.random() * 6);
        const duration = 1 + Math.floor(Math.random() * 2);
        const start = `${String(startHours).padStart(2, "0")}:00`;
        const end = `${String(startHours + duration).padStart(2, "0")}:00`;
        return {
          offset: 1,
          type: "SessionTimeChanged",
          payload: { sessionId: s.id, start, end, dayOffset: 0 },
        };
      },
      // Assign/unassign volunteer
      () => {
        const s =
          currentPlan.sessions[
            Math.floor(Math.random() * currentPlan.sessions.length)
          ];
        const volId =
          availableVolunteerIds[
            Math.floor(Math.random() * availableVolunteerIds.length)
          ];
        const isAssigned = s.volunteerIds.includes(volId);
        return {
          offset: 1,
          type: "VolunteerAssigned",
          payload: { sessionId: s.id, volunteerId: volId, assigned: !isAssigned },
        };
      },
      // Assign/unassign equipment
      () => {
        const s =
          currentPlan.sessions[
            Math.floor(Math.random() * currentPlan.sessions.length)
          ];
        const equipId =
          availableEquipmentIds[
            Math.floor(Math.random() * availableEquipmentIds.length)
          ];
        const isAssigned = s.equipmentIds.includes(equipId);
        return {
          offset: 1,
          type: "EquipmentAssigned",
          payload: { sessionId: s.id, equipmentId: equipId, assigned: !isAssigned },
        };
      },
      // Toggle equipment status
      () => {
        const equipId =
          availableEquipmentIds[
            Math.floor(Math.random() * availableEquipmentIds.length)
          ];
        const equip = currentPlan.equipment.find((e) => e.id === equipId)!;
        const nextStatus =
          equip.status === "ready" ? "needs-check" : "ready";
        return {
          offset: 1,
          type: "EquipmentStatusChanged",
          payload: { equipmentId: equipId, status: nextStatus },
        };
      },
      // Complete/reopen task
      () => {
        const t =
          currentPlan.tasks[
            Math.floor(Math.random() * currentPlan.tasks.length)
          ];
        return {
          offset: 1,
          type: "TaskCompleted",
          payload: { taskId: t.id, completed: !t.completed },
        };
      },
    ];

    // Run 60 random operations in sequence
    for (let step = 0; step < 60; step++) {
      let event: EventLogEntry;
      if (step === 30) {
        // Test PlanImported mid-stream
        event = {
          offset: step + 1,
          type: "PlanImported",
          payload: { plan: JSON.parse(JSON.stringify(demoPlan)) },
        };
      } else {
        const op = operations[step % operations.length];
        event = { ...op(), offset: step + 1 };
      }

      const affectedKeys = computeAffectedKeys(event, currentPlan);
      const nextPlan = replayEvents([event], undefined, currentPlan);

      const incremental = runIncrementalChecks(
        currentIssues,
        nextPlan,
        affectedKeys,
        FIXED_NOW
      );
      const full = runChecks(nextPlan, FIXED_NOW);

      // Verify exact equality of ordered IDs
      expect(incremental.issues.map((i) => i.id)).toEqual(
        full.map((i) => i.id)
      );

      // Verify complete deep equality
      expect(incremental.issues).toEqual(full);

      // Advance state for next iteration
      currentPlan = nextPlan;
      currentIssues = incremental.issues;
    }
  });
});

describe("Pure Conflict Delta Calculation & Replay", () => {
  it("correctly computes opened and resolved deltas and reconstructs state via replayDeltas", () => {
    const beforeIssues = runChecks(demoPlan, FIXED_NOW);
    const moveEvent: EventLogEntry<"SessionMoved"> = {
      offset: 1,
      type: "SessionMoved",
      payload: { sessionId: "session-robotics", venueId: "venue-room-c" },
    };
    const affected = computeAffectedKeys(moveEvent, demoPlan);
    const newPlan = replayEvents([moveEvent], undefined, demoPlan);
    const incremental = runIncrementalChecks(
      beforeIssues,
      newPlan,
      affected,
      FIXED_NOW
    );

    const { opened, resolved } = computeDeltas(beforeIssues, incremental.issues);

    expect(resolved.length).toBeGreaterThan(0);
    expect(resolved.some((r) => r.id.includes("session-robotics"))).toBe(true);

    // Turn initial issues into "opened" deltas, then apply the resolved deltas
    const deltas: Array<{ issue_id: string; op: "opened" | "resolved"; payload: any }> = [
      ...beforeIssues.map((i) => ({ issue_id: i.id, op: "opened" as const, payload: i })),
      ...resolved.map((i) => ({ issue_id: i.id, op: "resolved" as const, payload: i })),
      ...opened.map((i) => ({ issue_id: i.id, op: "opened" as const, payload: i })),
    ];

    const replayed = replayDeltas(deltas);
    expect(replayed.map((i) => i.id)).toEqual(incremental.issues.map((i) => i.id));
  });
});
