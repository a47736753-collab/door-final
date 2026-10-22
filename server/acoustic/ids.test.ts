import { describe, expect, it } from "vitest";
import { createIdTable, createSessionLookup } from "../../client/src/features/acoustic/ids";

describe("id tables", () => {
  it("maps text IDs to numbers and back", () => {
    const table = createSessionLookup([{ id: "session-robotics" }, { id: "session-coding" }, { id: "session-design" }]);
    expect(table.size).toBe(3);
    for (const id of ["session-robotics", "session-coding", "session-design"]) {
      const n = table.toNumber(id);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(table.toId(n!)).toBe(id);
    }
  });

  it("gives the same numbers whatever order the list arrives in", () => {
    const a = createIdTable(["b", "c", "a"]);
    const b = createIdTable(["a", "b", "c", "b"]);
    for (const id of ["a", "b", "c"]) expect(a.toNumber(id)).toBe(b.toNumber(id));
  });

  it("returns undefined for unknown IDs and numbers", () => {
    const table = createIdTable(["a"]);
    expect(table.toNumber("nope")).toBeUndefined();
    expect(table.toId(0)).toBeUndefined();
    expect(table.toId(2)).toBeUndefined();
    expect(table.toId(1.5)).toBeUndefined();
    expect(table.toId(Number.NaN)).toBeUndefined();
  });
});
