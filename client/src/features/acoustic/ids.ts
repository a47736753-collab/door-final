/**
 * The frame can only carry numbers, but DoorsOpen IDs are text like "session-robotics".
 * An IdTable turns a list of text IDs into numbers (1, 2, 3...) and back.
 *
 * The list is sorted first, so two devices holding the same list always agree on the
 * numbers, whatever order the list arrived in. If a session is added or removed, the
 * numbers shift, so both devices need the same (latest) plan.
 */
export interface IdTable {
  toNumber(id: string): number | undefined;
  toId(n: number): string | undefined;
  readonly size: number;
}

export function createIdTable(ids: readonly string[]): IdTable {
  const sorted = Array.from(new Set(ids)).sort();
  if (sorted.length > 0xffff) throw new RangeError("Too many IDs to fit in a 2-byte number.");
  const byId = new Map<string, number>();
  sorted.forEach((id, index) => byId.set(id, index + 1));
  return {
    toNumber: (id) => byId.get(id),
    toId: (n) => (Number.isInteger(n) && n >= 1 ? sorted[n - 1] : undefined),
    size: sorted.length,
  };
}

/** Session numbers for a list of sessions. */
export function createSessionLookup(sessions: readonly { id: string }[]): IdTable {
  return createIdTable(sessions.map((s) => s.id));
}

/** Volunteer numbers for a list of volunteers. */
export function createVolunteerLookup(volunteers: readonly { id: string }[]): IdTable {
  return createIdTable(volunteers.map((v) => v.id));
}
