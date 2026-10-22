import { hmacSha256 } from "./sha256";

/**
 * The 16-byte check-in message that travels as sound.
 *
 *  byte  0      version (high 4 bits) + message type (low 4 bits)
 *  bytes 1-2    volunteer number
 *  bytes 3-4    session number
 *  bytes 5-8    event-log offset the volunteer last saw  ("plan seen")
 *  bytes 9-10   message counter                          ("message #")
 *  byte  11     status: 1 = ready, 0 = not ready
 *  bytes 12-15  seal: first 4 bytes of HMAC-SHA256 over bytes 0-11, using the volunteer's key
 *
 * All numbers are big-endian.
 */

export const FRAME_LENGTH = 16;
export const BODY_LENGTH = 12;
export const SEAL_LENGTH = 4;
export const FRAME_VERSION = 1;
export const MESSAGE_TYPE_STATUS = 1;
export const STATUS_NOT_READY = 0;
export const STATUS_READY = 1;

export type FieldId = "kind" | "who" | "session" | "plan" | "count" | "status" | "seal";

/** Where each field lives inside the frame. The UI uses this to draw the byte ribbon. */
export const FIELD_LAYOUT: readonly {
  id: FieldId;
  label: string;
  technical: string;
  start: number;
  length: number;
}[] = [
  { id: "kind", label: "Kind", technical: "version + message type", start: 0, length: 1 },
  { id: "who", label: "Who", technical: "volunteer number", start: 1, length: 2 },
  { id: "session", label: "Session", technical: "session number", start: 3, length: 2 },
  { id: "plan", label: "Plan seen", technical: "event-log offset the volunteer last saw", start: 5, length: 4 },
  { id: "count", label: "Message #", technical: "sequence number", start: 9, length: 2 },
  { id: "status", label: "Status", technical: "1 = ready, 0 = not ready", start: 11, length: 1 },
  { id: "seal", label: "Seal", technical: "4-byte truncated HMAC-SHA256", start: 12, length: 4 },
];

export interface FrameFields {
  volunteer: number;
  session: number;
  basedOnOffset: number;
  seq: number;
  status: 0 | 1;
}

export interface Frame extends FrameFields {
  version: number;
  type: number;
}

function assertInt(name: string, value: number, max: number) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be a whole number from 0 to ${max} (got ${value})`);
  }
}

/** Bytes 0-11: everything the seal covers. Throws RangeError if a field does not fit. */
export function packBody(fields: FrameFields): Uint8Array {
  assertInt("volunteer", fields.volunteer, 0xffff);
  assertInt("session", fields.session, 0xffff);
  assertInt("basedOnOffset", fields.basedOnOffset, 0xffffffff);
  assertInt("seq", fields.seq, 0xffff);
  if (fields.status !== STATUS_READY && fields.status !== STATUS_NOT_READY) {
    throw new RangeError(`status must be 0 or 1 (got ${fields.status})`);
  }

  const body = new Uint8Array(BODY_LENGTH);
  const view = new DataView(body.buffer);
  body[0] = (FRAME_VERSION << 4) | MESSAGE_TYPE_STATUS;
  view.setUint16(1, fields.volunteer);
  view.setUint16(3, fields.session);
  view.setUint32(5, fields.basedOnOffset);
  view.setUint16(9, fields.seq);
  body[11] = fields.status;
  return body;
}

export function signBody(body: Uint8Array, key: Uint8Array): Uint8Array {
  return hmacSha256(key, body).slice(0, SEAL_LENGTH);
}

/** Builds the full 16-byte frame, sealed with the volunteer's key. */
export function packFrame(fields: FrameFields, key: Uint8Array): Uint8Array {
  const body = packBody(fields);
  const frame = new Uint8Array(FRAME_LENGTH);
  frame.set(body, 0);
  frame.set(signBody(body, key), BODY_LENGTH);
  return frame;
}

export type UnpackResult =
  | { ok: true; frame: Frame; body: Uint8Array; seal: Uint8Array }
  | { ok: false; reason: string };

/** Reads the fields out of a frame. Never throws; garbage gives `{ ok: false }`. This does NOT check the seal. */
export function unpackFrame(input: unknown): UnpackResult {
  if (!(input instanceof Uint8Array)) return { ok: false, reason: "That is not a 16-byte message." };
  if (input.length !== FRAME_LENGTH) {
    return { ok: false, reason: `Expected 16 bytes but got ${input.length}.` };
  }

  const version = input[0] >> 4;
  const type = input[0] & 0x0f;
  if (version !== FRAME_VERSION) return { ok: false, reason: `Unknown message version ${version}.` };
  if (type !== MESSAGE_TYPE_STATUS) return { ok: false, reason: `Unknown message type ${type}.` };

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const status = input[11];
  if (status !== STATUS_READY && status !== STATUS_NOT_READY) {
    return { ok: false, reason: `Unknown status value ${status}.` };
  }

  return {
    ok: true,
    frame: {
      version,
      type,
      volunteer: view.getUint16(1),
      session: view.getUint16(3),
      basedOnOffset: view.getUint32(5),
      seq: view.getUint16(9),
      status,
    },
    body: input.slice(0, BODY_LENGTH),
    seal: input.slice(BODY_LENGTH, FRAME_LENGTH),
  };
}

/** Compares seals without stopping at the first different byte. */
export function verifySeal(body: Uint8Array, seal: Uint8Array, key: Uint8Array): boolean {
  const expected = signBody(body, key);
  if (seal.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ seal[i];
  return difference === 0;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Accepts "a1 b2 c3", "a1b2c3" or "0xa1,0xb2". Returns null when it is not clean hex. */
export function fromHex(text: string): Uint8Array | null {
  const clean = text.replace(/0x/gi, "").replace(/[\s,:-]/g, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
