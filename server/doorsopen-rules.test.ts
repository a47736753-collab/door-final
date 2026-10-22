import { describe, expect, it } from "vitest";
import { createEmptyPlan, demoPlan } from "../client/src/features/doorsopen/demo-data";
import { parseEventFile, importTemplate } from "../client/src/features/doorsopen/import-data";
import { readinessScore, runChecks, simulatePlan } from "../client/src/features/doorsopen/checks";
import type { EventPlan } from "../client/src/features/doorsopen/types";

const minimalPlan = (secondRoom: boolean): EventPlan => ({
  event: { id: "event-test", name: "Test event", subtitle: "", date: "2026-11-15T00:00:00.000Z", venueName: "Test venue", isSample: false },
  venues: [
    { id: "room-a", name: "Room A", type: "room", capacity: 80, zone: "North", accessible: true, x: 0, y: 0, width: 100, height: 60 },
    ...(secondRoom ? [{ id: "room-b", name: "Room B", type: "room" as const, capacity: 80, zone: "South", accessible: true, x: 110, y: 0, width: 100, height: 60 }] : []),
  ],
  sessions: [
    { id: "session-a", title: "A", kind: "Talk", venueId: "room-a", start: "10:00", end: "11:00", expectedAttendance: 24, volunteerIds: [], equipmentIds: [], dayOffset: 0 },
    { id: "session-b", title: "B", kind: "Talk", venueId: secondRoom ? "room-b" : "room-a", start: "10:30", end: "11:30", expectedAttendance: 20, volunteerIds: [], equipmentIds: [], dayOffset: 0 },
  ],
  volunteers: [], equipment: [], tasks: [],
});

describe("DoorsOpen deterministic readiness rules", () => {
  it("flags simultaneous sessions only when they use the same room", () => {
    expect(runChecks(minimalPlan(false)).some((issue) => issue.kind === "room")).toBe(true);
    expect(runChecks(minimalPlan(true)).some((issue) => issue.kind === "room")).toBe(false);
  });

  it("resolves the Room A collision after moving Robotics to Room C, but keeps projector P1 double-booked", () => {
    const originalRoomConflict = runChecks(demoPlan).find((issue) => issue.kind === "room" && issue.links.some((link) => link.id === "session-robotics"));
    const projectorIssue = runChecks(demoPlan).find((issue) => issue.kind === "equipment" && issue.title.includes("Projector P1") && issue.title.includes("double-booked"));
    expect(originalRoomConflict).toBeDefined();
    expect(projectorIssue).toBeDefined();

    const proposed = { ...demoPlan, sessions: demoPlan.sessions.map((session) => session.id === "session-robotics" ? { ...session, venueId: "venue-room-c" } : session) };
    const comparison = simulatePlan(demoPlan, proposed);
    expect(comparison.resolved.some((issue) => issue.id === originalRoomConflict!.id)).toBe(true);
    expect(comparison.after.some((issue) => issue.id === originalRoomConflict!.id)).toBe(false);
    expect(comparison.after.some((issue) => issue.id === projectorIssue!.id)).toBe(true);
  });

  it("does not present an empty issue list as a score below 100", () => {
    expect(readinessScore([])).toBe(100);
    expect(runChecks(minimalPlan(true)).length).toBe(0);
  });

  it("parses the downloadable template as five linked records without guessing a venue", async () => {
    const event = createEmptyPlan("Imported test event", "2026-11-15T09:00:00.000Z");
    const file = new File([importTemplate], "doorsopen-template.csv", { type: "text/csv" });
    const result = await parseEventFile(file, event);
    expect(result.errors).toEqual([]);
    expect(result.added).toBe(5);
    expect(result.plan?.venues.map((venue) => venue.name)).toContain("Room D");
    expect(result.plan?.sessions[0].venueId).toBe(result.plan?.venues[0].id);
    expect(result.plan?.sessions[0].equipmentIds).toHaveLength(1);
  });
});
