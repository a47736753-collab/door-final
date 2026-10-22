import { describe, expect, it } from "vitest";
import { packFrame } from "../../client/src/features/acoustic/frame";
import { classifyFrame, createLedger, recordVerdict, type Lookups } from "../../client/src/features/acoustic/rules";
import { sessionOffsets, latestLogOffset } from "../../client/src/features/acoustic/staleness";
import { demoPlan } from "../../client/src/features/doorsopen/demo-data";

const keyOf = (n: number) => new Uint8Array(32).fill(n);
const sessions = new Map<number, string>([[1, "session-a"], [2, "session-b"]]);
let latest: Record<number, number> = {};

const lookups: Lookups = {
  getKey: (v) => (v === 1 || v === 2 ? keyOf(v) : undefined),
  sessionIdFor: (s) => sessions.get(s),
  latestOffsetFor: (s) => latest[s] ?? 0,
};

const send = (over: Partial<{ volunteer: number; session: number; basedOnOffset: number; seq: number; status: 0 | 1 }> = {}) => {
  const f = { volunteer: 1, session: 1, basedOnOffset: 10, seq: 1, status: 1 as const, ...over };
  return packFrame(f, keyOf(f.volunteer));
};

function hear(ledger: ReturnType<typeof createLedger>, bytes: unknown) {
  const result = classifyFrame(bytes, ledger, lookups);
  recordVerdict(ledger, result);
  return result;
}

describe("classifyFrame", () => {
  it("accepts a good message", () => {
    latest = { 1: 5 };
    expect(hear(createLedger(), send()).kind).toBe("accepted");
  });

  it("calls the same volunteer + message number a duplicate", () => {
    latest = {};
    const ledger = createLedger();
    expect(hear(ledger, send({ seq: 4 })).kind).toBe("accepted");
    expect(hear(ledger, send({ seq: 4 })).kind).toBe("duplicate");
  });

  it("still calls a repeated stale message a duplicate", () => {
    latest = { 1: 50 };
    const ledger = createLedger();
    expect(hear(ledger, send({ seq: 2, basedOnOffset: 10 })).kind).toBe("stale");
    expect(hear(ledger, send({ seq: 2, basedOnOffset: 10 })).kind).toBe("duplicate");
  });

  it("flags a lower message number after a higher one was accepted as reordered, and does not apply it", () => {
    latest = {};
    const ledger = createLedger();
    expect(hear(ledger, send({ seq: 5 })).kind).toBe("accepted");
    expect(hear(ledger, send({ seq: 3 })).kind).toBe("reordered");
    // the reordered one must not have moved the high-water mark down
    expect(hear(ledger, send({ seq: 4 })).kind).toBe("reordered");
    expect(hear(ledger, send({ seq: 6 })).kind).toBe("accepted");
  });

  it("tracks message numbers per session, so a different session is not reordered", () => {
    latest = {};
    const ledger = createLedger();
    expect(hear(ledger, send({ seq: 9, session: 1 })).kind).toBe("accepted");
    expect(hear(ledger, send({ seq: 3, session: 2 })).kind).toBe("accepted");
  });

  it("rejects a bad seal and an unknown volunteer as forged", () => {
    latest = {};
    const tampered = send();
    tampered[15] ^= 0xff;
    expect(hear(createLedger(), tampered).kind).toBe("forged");

    const changed = send();
    changed[11] = 0; // flip ready -> not ready without re-sealing
    expect(hear(createLedger(), changed).kind).toBe("forged");

    const stranger = packFrame({ volunteer: 77, session: 1, basedOnOffset: 10, seq: 1, status: 1 }, keyOf(77));
    expect(hear(createLedger(), stranger).kind).toBe("forged");

    const wrongKey = packFrame({ volunteer: 1, session: 1, basedOnOffset: 10, seq: 1, status: 1 }, keyOf(2));
    expect(hear(createLedger(), wrongKey).kind).toBe("forged");
  });

  it("does not remember forged messages, so the real one still gets through", () => {
    latest = {};
    const ledger = createLedger();
    const fake = send({ seq: 8 });
    fake[14] ^= 1;
    expect(hear(ledger, fake).kind).toBe("forged");
    expect(hear(ledger, send({ seq: 8 })).kind).toBe("accepted");
  });

  it("is stale when the plan changed after the volunteer last saw it", () => {
    latest = { 1: 20 };
    const result = hear(createLedger(), send({ basedOnOffset: 19 }));
    expect(result.kind).toBe("stale");
    expect(result.latestOffset).toBe(20);
    latest = { 1: 20 };
    expect(hear(createLedger(), send({ basedOnOffset: 20, seq: 2 })).kind).toBe("accepted");
  });

  it("is stale when the session is not in the plan", () => {
    latest = {};
    expect(hear(createLedger(), send({ session: 9 })).kind).toBe("stale");
  });

  it("never throws on garbage", () => {
    const junk: unknown[] = [null, undefined, 0, "text", {}, [], new Uint8Array(0), new Uint8Array(16), new Uint8Array(40), Float32Array.of(1, 2), () => 1];
    for (const item of junk) {
      let result;
      expect(() => { result = hear(createLedger(), item); }).not.toThrow();
      expect((result as any).kind).toBe("forged");
    }
  });

  it("survives lookups that throw", () => {
    const broken: Lookups = { getKey: () => { throw new Error("boom"); }, sessionIdFor: () => undefined, latestOffsetFor: () => 0 };
    expect(classifyFrame(send(), createLedger(), broken).kind).toBe("forged");
  });
});

describe("sessionOffsets (stale input from the event log)", () => {
  const log = [
    { offset: 1, type: "PlanImported", payload: {} },
    { offset: 2, type: "SessionMoved", payload: { sessionId: "session-robotics", venueId: "venue-room-c" } },
    { offset: 3, type: "ConfirmationAccepted", payload: { sessionId: "session-design" } },
    { offset: 4, type: "TaskCompleted", payload: { taskId: "task-access", completed: true } },
    { offset: "5", type: "EquipmentStatusChanged", payload: { equipmentId: "equipment-mic2", status: "ready" } },
    { offset: 6, type: "VolunteerAssigned", payload: { sessionId: "session-coding", volunteerId: "volunteer-eli" } },
  ] as any[];

  it("ignores confirmations and tasks, follows sessions and equipment", () => {
    const offsets = sessionOffsets(log, demoPlan);
    expect(offsets["session-robotics"]).toBe(2);
    expect(offsets["session-coding"]).toBe(6);
    // design and keynote use equipment-mic2
    expect(offsets["session-design"]).toBe(5);
    expect(offsets["session-keynote"]).toBe(5);
    expect(offsets["session-showcase"]).toBe(1);
  });

  it("gives 0 for an empty log and finds the newest offset", () => {
    expect(sessionOffsets([], demoPlan)["session-robotics"]).toBe(0);
    expect(latestLogOffset([])).toBe(0);
    expect(latestLogOffset(log)).toBe(6);
  });
});
