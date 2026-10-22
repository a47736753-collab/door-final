import { type Frame, unpackFrame, verifySeal } from "./frame";

export type VerdictKind = "accepted" | "duplicate" | "reordered" | "forged" | "stale";

export interface Classification {
  kind: VerdictKind;
  /** One plain sentence explaining the verdict. */
  reason: string;
  /** The fields read from the message (missing only when the bytes were unreadable). */
  frame?: Frame;
  /** The session's latest plan change, when the verdict depends on it. */
  latestOffset?: number;
}

/** What the listener remembers between messages. */
export interface Ledger {
  /** "volunteer:seq" for every authentic message heard, whatever its verdict. */
  seen: Set<string>;
  /** "volunteer:session" -> highest message number that was accepted. */
  applied: Map<string, number>;
}

export function createLedger(): Ledger {
  return { seen: new Set(), applied: new Map() };
}

export interface Lookups {
  /** The secret key for a volunteer number, or undefined when nobody has that number. */
  getKey(volunteer: number): Uint8Array | undefined;
  /** The text session ID for a session number, or undefined when the plan has no such session. */
  sessionIdFor(session: number): string | undefined;
  /** The highest event-log offset that changed this session or its resources (0 = never changed). */
  latestOffsetFor(session: number): number;
}

const seenKey = (volunteer: number, seq: number) => `${volunteer}:${seq}`;
const appliedKey = (volunteer: number, session: number) => `${volunteer}:${session}`;

/**
 * Decides what to do with a message that was heard.
 *
 *  forged     unreadable, from an unknown volunteer, or the seal does not match
 *  duplicate  this volunteer already sent this message number
 *  stale      the plan changed after the volunteer last saw it (or the session no longer exists)
 *  reordered  an older message number arrived after a newer one was already accepted
 *  accepted   everything checks out
 *
 * Pure: it reads the ledger but never changes it (call `recordVerdict` for that),
 * and it never throws, whatever it is given.
 */
export function classifyFrame(input: unknown, ledger: Ledger, lookups: Lookups): Classification {
  try {
    const unpacked = unpackFrame(input);
    if (!unpacked.ok) return { kind: "forged", reason: unpacked.reason };

    const { frame, body, seal } = unpacked;

    const key = lookups.getKey(frame.volunteer);
    if (!key) {
      return { kind: "forged", reason: `Nobody is registered as volunteer #${frame.volunteer}.`, frame };
    }
    if (!verifySeal(body, seal, key)) {
      return { kind: "forged", reason: "The seal does not match, so this message may not be from that volunteer.", frame };
    }

    // From here on the message is authentic.
    if (ledger.seen.has(seenKey(frame.volunteer, frame.seq))) {
      return { kind: "duplicate", reason: `Message #${frame.seq} from this volunteer was already received.`, frame };
    }

    if (lookups.sessionIdFor(frame.session) === undefined) {
      return { kind: "stale", reason: `Session #${frame.session} is not in the current plan.`, frame };
    }

    const highest = ledger.applied.get(appliedKey(frame.volunteer, frame.session));
    if (highest !== undefined && frame.seq < highest) {
      return {
        kind: "reordered",
        reason: `Message #${frame.seq} arrived after message #${highest} was already accepted, so it is not applied.`,
        frame,
      };
    }

    const latest = lookups.latestOffsetFor(frame.session);
    if (frame.basedOnOffset < latest) {
      return {
        kind: "stale",
        reason: `Sent from plan version ${frame.basedOnOffset}, but this session changed at version ${latest}.`,
        frame,
        latestOffset: latest,
      };
    }

    return { kind: "accepted", reason: "Everything checks out.", frame, latestOffset: latest };
  } catch (error) {
    return {
      kind: "forged",
      reason: error instanceof Error ? `Could not read this message: ${error.message}` : "Could not read this message.",
    };
  }
}

/** Remembers a classified message. Forged messages are not remembered; everything authentic is. */
export function recordVerdict(ledger: Ledger, result: Classification): void {
  const frame = result.frame;
  if (!frame || result.kind === "forged") return;
  ledger.seen.add(seenKey(frame.volunteer, frame.seq));
  if (result.kind === "accepted") {
    const key = appliedKey(frame.volunteer, frame.session);
    const highest = ledger.applied.get(key);
    if (highest === undefined || frame.seq > highest) ledger.applied.set(key, frame.seq);
  }
}
