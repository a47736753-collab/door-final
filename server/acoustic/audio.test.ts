import { describe, expect, it } from "vitest";
import { createGgwaveEngine, normalizePayload, type AudioEngine } from "../../client/src/features/acoustic/audio";
import { packFrame, toHex, unpackFrame } from "../../client/src/features/acoustic/frame";

const key = new Uint8Array(32).fill(3);
const frame = packFrame({ volunteer: 2, session: 5, basedOnOffset: 41, seq: 17, status: 1 }, key);

describe("normalizePayload", () => {
  it("accepts 16 raw bytes", () => {
    expect(normalizePayload(frame)).toEqual(frame);
  });
  it("accepts the same message sent as 32 hex characters", () => {
    expect(normalizePayload(new TextEncoder().encode(toHex(frame)))).toEqual(frame);
  });
  it("refuses anything else", () => {
    expect(normalizePayload(null)).toBeNull();
    expect(normalizePayload(new Uint8Array(0))).toBeNull();
    expect(normalizePayload(new Uint8Array(7))).toBeNull();
    expect(normalizePayload(new TextEncoder().encode("z".repeat(32)))).toBeNull();
  });
});

/**
 * Audio round trip with NO microphone: encode to samples, then feed those samples straight back
 * into the decoder in small chunks, the way the microphone would deliver them.
 * This needs the real `ggwave` package, so it is skipped until you run `pnpm add ggwave`.
 */
let ggwaveInstalled = true;
try {
  await import("ggwave");
} catch {
  ggwaveInstalled = false;
}

function listen(engine: AudioEngine, samples: Float32Array): Uint8Array | null {
  const chunk = 1024;
  const padded = new Float32Array(samples.length + engine.sampleRate * 2); // trailing silence lets the decoder finish
  padded.set(samples);
  for (let i = 0; i + chunk <= padded.length; i += chunk) {
    const heard = engine.decode(padded.slice(i, i + chunk));
    if (heard) return heard;
  }
  return null;
}

describe.skipIf(!ggwaveInstalled)("ggwave audio round trip (no microphone)", () => {
  for (const protocol of ["normal", "fast"] as const) {
    it(`sends the 16 bytes as sound and gets the same 16 bytes back (${protocol})`, async () => {
      const engine = await createGgwaveEngine(48000, protocol);
      const samples = engine.encode(frame);
      expect(samples.length).toBeGreaterThan(48000 / 2); // at least half a second of sound
      const heard = listen(engine, samples);
      expect(heard).toEqual(frame);
      const unpacked = unpackFrame(heard);
      expect(unpacked.ok).toBe(true);
    });
  }

  it("hears nothing in silence or noise, and does not crash", async () => {
    const engine = await createGgwaveEngine(48000, "normal");
    expect(listen(engine, new Float32Array(48000))).toBeNull();
    const noise = Float32Array.from({ length: 48000 }, () => (Math.random() - 0.5) * 0.2);
    expect(listen(engine, noise)).toBeNull();
  });
});
