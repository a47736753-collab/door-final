import { FRAME_LENGTH, fromHex, toHex } from "./frame";

/**
 * Sound layer: turns the 16 message bytes into audio and back, using the `ggwave` package.
 *
 * ggwave is loaded on demand (dynamic import), so the rest of the site never pays for it
 * and keeps working if the package is missing. Only the sound-check-in page needs it.
 */

export type ProtocolName = "normal" | "fast";

/** The plan is to send the 16 raw bytes. If your ggwave build mangles binary, switch to "hex" (32 text characters, about twice as long). */
export const PAYLOAD_MODE: "binary" | "hex" = "binary";

/** ggwave loudness, 0-100. */
export const DEFAULT_VOLUME = 50;

export interface AudioEngine {
  sampleRate: number;
  protocol: ProtocolName;
  /** Bytes -> audio samples (mono, -1..1). */
  encode(bytes: Uint8Array): Float32Array;
  /** Audio samples -> the decoded message, or null when nothing was heard. Call repeatedly with consecutive chunks. */
  decode(samples: Float32Array): Uint8Array | null;
}

/** Turns whatever ggwave returned into the 16 message bytes (or null). Accepts raw bytes or hex text. */
export function normalizePayload(received: Uint8Array | null | undefined): Uint8Array | null {
  if (!received || received.length === 0) return null;
  if (received.length === FRAME_LENGTH) return received;
  if (received.length === FRAME_LENGTH * 2) {
    const decoded = fromHex(new TextDecoder().decode(received));
    if (decoded && decoded.length === FRAME_LENGTH) return decoded;
  }
  return null;
}

// ---- sample <-> byte conversions (ggwave's JavaScript build passes samples as raw bytes) -----------

function floatsToInt8(samples: Float32Array): Int8Array {
  const copy = new Uint8Array(samples.byteLength);
  copy.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  return new Int8Array(copy.buffer);
}

function bytesToFloats(raw: ArrayBufferView): Float32Array {
  if (raw instanceof Float32Array) return raw;
  const copy = new Uint8Array(raw.byteLength);
  copy.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  return new Float32Array(copy.buffer);
}

/** Loads ggwave and wraps it as an AudioEngine. Throws a readable error if the package is not installed. */
export async function createGgwaveEngine(
  sampleRate: number,
  protocol: ProtocolName = "normal",
  volume: number = DEFAULT_VOLUME,
): Promise<AudioEngine> {
  let module: any;
  try {
    module = await import("ggwave");
  } catch (cause) {
    throw new Error("The sound engine is not installed. Run `pnpm add ggwave` in the project folder, then restart `pnpm dev`.", { cause });
  }

  const factory = module.default ?? module;
  if (typeof factory !== "function") throw new Error("ggwave loaded, but its entry point was not what we expected.");
  const ggwave = await factory();

  const parameters = ggwave.getDefaultParameters();
  parameters.sampleRateInp = sampleRate;
  parameters.sampleRateOut = sampleRate;
  const instance = ggwave.init(parameters);

  // Newer builds call this `ProtocolId`, older ones `TxProtocolId`.
  const ids = ggwave.ProtocolId ?? ggwave.TxProtocolId;
  const suffix = protocol === "fast" ? "AUDIBLE_FAST" : "AUDIBLE_NORMAL";
  const protocolId = ids?.[`GGWAVE_PROTOCOL_${suffix}`] ?? ids?.[`GGWAVE_TX_PROTOCOL_${suffix}`];
  if (protocolId === undefined) throw new Error("This ggwave version has no audible protocol to use.");

  return {
    sampleRate,
    protocol,
    encode(bytes) {
      const payload = PAYLOAD_MODE === "hex" ? toHex(bytes) : bytes;
      const waveform = ggwave.encode(instance, payload, protocolId, volume);
      if (!waveform || waveform.length === 0) throw new Error("ggwave could not turn that message into sound.");
      return bytesToFloats(waveform);
    },
    decode(samples) {
      const result = ggwave.decode(instance, floatsToInt8(samples));
      if (!result || result.length === 0) return null;
      const bytes =
        typeof result === "string"
          ? Uint8Array.from(result as string, (c) => c.charCodeAt(0) & 0xff)
          : result instanceof Uint8Array
            ? result
            : new Uint8Array(result);
      return normalizePayload(bytes);
    },
  };
}

// ---- browser audio: playing the chirp and listening on the microphone --------------------------

export interface ListenHandle {
  stop(): void;
}

export interface ListenOptions {
  onFrame(bytes: Uint8Array): void;
  /** Loudness 0..1, called about 20 times a second. */
  onLevel?(level: number): void;
}

export interface BrowserAudio {
  /** Loads the sound engine (safe to call many times). */
  prepare(protocol: ProtocolName): Promise<AudioEngine>;
  /** Plays samples through the speakers. Resolves when finished. */
  play(samples: Float32Array, sampleRate: number): Promise<void>;
  /** Starts the microphone. Rejects with a readable message when it is blocked or unavailable. */
  listen(protocol: ProtocolName, options: ListenOptions): Promise<ListenHandle>;
}

export function createBrowserAudio(): BrowserAudio {
  let context: AudioContext | null = null;
  const engines = new Map<ProtocolName, Promise<AudioEngine>>();

  const getContext = () => {
    if (!context) {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor) throw new Error("This browser cannot play or record sound.");
      context = new Ctor() as AudioContext;
    }
    return context;
  };

  const prepare = (protocol: ProtocolName) => {
    let engine = engines.get(protocol);
    if (!engine) {
      engine = createGgwaveEngine(getContext().sampleRate, protocol);
      // Do not cache a failure: the person may install the package and retry.
      engine.catch(() => engines.delete(protocol));
      engines.set(protocol, engine);
    }
    return engine;
  };

  return {
    prepare,

    async play(samples, sampleRate) {
      const ctx = getContext();
      if (ctx.state === "suspended") await ctx.resume();
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.copyToChannel(new Float32Array(samples), 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      await new Promise<void>((resolve) => {
        source.onended = () => resolve();
        source.start();
      });
    },

    async listen(protocol, options) {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("The microphone needs a secure page. Open the site on localhost or over https.");
      }
      const engine = await prepare(protocol);
      const ctx = getContext();
      if (ctx.state === "suspended") await ctx.resume();

      let stream: MediaStream;
      try {
        // Echo cancellation and noise suppression would eat the chirps, so switch them off.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
        });
      } catch {
        throw new Error("The microphone is blocked. Allow microphone access for this site, then try again.");
      }

      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but works in every browser and keeps this file simple.
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0;

      let stopped = false;
      processor.onaudioprocess = (event) => {
        if (stopped) return;
        const input = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        options.onLevel?.(Math.min(1, Math.sqrt(sum / input.length) * 6));
        try {
          const bytes = engine.decode(new Float32Array(input));
          if (bytes) options.onFrame(bytes);
        } catch {
          /* a bad chunk of sound must never stop the microphone */
        }
      };

      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);

      return {
        stop() {
          stopped = true;
          processor.onaudioprocess = null;
          source.disconnect();
          processor.disconnect();
          mute.disconnect();
          stream.getTracks().forEach((track) => track.stop());
        },
      };
    },
  };
}
