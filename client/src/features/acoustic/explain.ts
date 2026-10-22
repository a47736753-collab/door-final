import type { FieldId } from "./frame";

export interface FieldFacts {
  volunteerNumber?: number;
  volunteerName?: string;
  sessionNumber?: number;
  sessionTitle?: string;
  planSeen?: number;
  seq?: number;
  status?: 0 | 1;
  /** Whether the seal is known to match, to be wrong, or has not been checked yet. */
  seal?: "matches" | "broken" | "pending";
}

/** Plain-language meaning of each part of the message, for the hover/tap inspector. */
export function explainField(id: FieldId, facts: FieldFacts): string | undefined {
  switch (id) {
    case "kind":
      return "Message version 1, type 1: a status check-in. Anything else is ignored.";
    case "who":
      return facts.volunteerNumber === undefined
        ? "Which volunteer is speaking. Pick your name to fill this in."
        : `${facts.volunteerName ?? "Unknown volunteer"} is volunteer #${facts.volunteerNumber} on this plan.`;
    case "session":
      return facts.sessionNumber === undefined
        ? "Which session this is about. Pick a session to fill this in."
        : `${facts.sessionTitle ?? "Unknown session"} is session #${facts.sessionNumber} on this plan.`;
    case "plan":
      return facts.planSeen === undefined
        ? "The plan version the sender last saw."
        : `The sender last saw plan version ${facts.planSeen}. If the plan changed after that, the message is out of date.`;
    case "count":
      return facts.seq === undefined
        ? "A counter that goes up with every message."
        : `Message #${facts.seq} from this volunteer. It counts up on every play, so repeats and old messages are spotted.`;
    case "status":
      return facts.status === undefined ? "Ready or not ready." : facts.status === 1 ? "Ready." : "Not ready.";
    case "seal":
      return facts.seal === "matches"
        ? "The seal matches: only someone holding this volunteer’s secret key could have made it."
        : facts.seal === "broken"
          ? "The seal does not match, so a byte was changed or the sender does not hold the key."
          : "A 4-byte signature made with the volunteer’s secret key. Change any byte and it stops matching.";
  }
}
