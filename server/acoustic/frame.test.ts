import { createHmac, createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256, hmacSha256 } from "../../client/src/features/acoustic/sha256";
import {
  FRAME_LENGTH,
  fromHex,
  packFrame,
  toHex,
  unpackFrame,
  verifySeal,
} from "../../client/src/features/acoustic/frame";

const key = new Uint8Array(32).fill(7);

describe("sha256 / hmac (pure TypeScript)", () => {
  it("matches Node crypto for many input sizes", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = new Uint8Array(randomBytes(size));
      expect(toHex(sha256(data))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("matches Node crypto HMAC, including keys longer than one block", () => {
    for (const keySize of [1, 16, 32, 64, 65, 200]) {
      const k = new Uint8Array(randomBytes(keySize));
      const message = new Uint8Array(randomBytes(12));
      expect(toHex(hmacSha256(k, message))).toBe(createHmac("sha256", k).update(message).digest("hex"));
    }
  });
});

describe("frame codec", () => {
  const fields = { volunteer: 3, session: 12, basedOnOffset: 70000, seq: 9, status: 1 as const };

  it("packs to exactly 16 bytes and round-trips", () => {
    const frame = packFrame(fields, key);
    expect(frame).toHaveLength(FRAME_LENGTH);
    const result = unpackFrame(frame);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.frame).toMatchObject(fields);
      expect(verifySeal(result.body, result.seal, key)).toBe(true);
    }
  });

  it("uses the documented byte layout", () => {
    const frame = packFrame(fields, key);
    expect(frame[0]).toBe(0x11); // version 1, type 1
    expect(Array.from(frame.slice(1, 3))).toEqual([0, 3]);
    expect(Array.from(frame.slice(3, 5))).toEqual([0, 12]);
    expect(Array.from(frame.slice(5, 9))).toEqual([0, 1, 0x11, 0x70]); // 70000
    expect(Array.from(frame.slice(9, 11))).toEqual([0, 9]);
    expect(frame[11]).toBe(1);
  });

  it("seals with the first 4 bytes of HMAC-SHA256 over bytes 0-11", () => {
    const frame = packFrame(fields, key);
    const expected = createHmac("sha256", key).update(frame.slice(0, 12)).digest().subarray(0, 4);
    expect(toHex(frame.slice(12))).toBe(expected.toString("hex"));
  });

  it("detects a changed byte or the wrong key", () => {
    const frame = packFrame(fields, key);
    const result = unpackFrame(frame);
    if (!result.ok) throw new Error("expected ok");
    expect(verifySeal(result.body, result.seal, new Uint8Array(32).fill(8))).toBe(false);
    const tampered = frame.slice();
    tampered[11] = 0;
    const again = unpackFrame(tampered);
    if (!again.ok) throw new Error("expected ok");
    expect(verifySeal(again.body, again.seal, key)).toBe(false);
  });

  it("rejects values that do not fit instead of wrapping around", () => {
    expect(() => packFrame({ ...fields, volunteer: 70000 }, key)).toThrow(RangeError);
    expect(() => packFrame({ ...fields, seq: -1 }, key)).toThrow(RangeError);
    expect(() => packFrame({ ...fields, basedOnOffset: 2 ** 32 }, key)).toThrow(RangeError);
  });

  it("unpack never throws on garbage", () => {
    for (const junk of [null, undefined, 42, "hello", {}, [], new Uint8Array(0), new Uint8Array(15), new Uint8Array(17), new Uint8Array(16)]) {
      expect(unpackFrame(junk).ok).toBe(false);
    }
  });

  it("hex helpers round-trip and refuse bad text", () => {
    const frame = packFrame(fields, key);
    expect(fromHex(toHex(frame))).toEqual(frame);
    expect(fromHex("11 00 0a")).toEqual(new Uint8Array([0x11, 0, 0x0a]));
    expect(fromHex("zz")).toBeNull();
    expect(fromHex("abc")).toBeNull();
    expect(fromHex("")).toBeNull();
  });
});
