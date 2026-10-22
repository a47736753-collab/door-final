import { STATUS_READY } from "./frame";
import type { Classification, VerdictKind } from "./rules";

export type Tone = "good" | "quiet" | "warn" | "bad";

export const VERDICTS: Record<VerdictKind, { label: string; tone: Tone; meaning: string }> = {
  accepted: { label: "Recorded", tone: "good", meaning: "Checked and counted." },
  duplicate: { label: "Already heard", tone: "quiet", meaning: "The same message arrived twice. The repeat is ignored." },
  reordered: { label: "Out of order", tone: "warn", meaning: "An older message arrived after a newer one. It is listed but not applied." },
  stale: { label: "Out of date", tone: "warn", meaning: "The plan changed after this volunteer last saw it. Ask them to sync and send again." },
  forged: { label: "Can’t verify", tone: "bad", meaning: "The seal did not match or the sender is unknown. It is rejected." },
};

export const statusWord = (status: number | undefined) => (status === STATUS_READY ? "ready" : "not ready");

/** One human sentence for a heard message, e.g. "Asha Patel says Robotics Workshop is ready." */
export function describeHeard(
  result: Classification,
  names: { volunteer?: string; session?: string },
): string {
  const frame = result.frame;
  if (!frame) return "Heard a sound that was not a valid check-in.";
  const who = names.volunteer ?? `Volunteer #${frame.volunteer}`;
  const what = names.session ?? `session #${frame.session}`;
  if (result.kind === "forged") return `Someone claiming to be ${who} sent a message for ${what}.`;
  return `${who} says ${what} is ${statusWord(frame.status)}.`;
}
