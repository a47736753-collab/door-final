import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, type EventPlan } from "../doorsopen/types";
import { ByteRibbon } from "./ByteRibbon";
import { Burst } from "./Delight";
import { explainField } from "./explain";
import { type AudioEngine, type BrowserAudio, type ProtocolName } from "./audio";
import { FIELD_LAYOUT, FRAME_LENGTH, MESSAGE_TYPE_STATUS, FRAME_VERSION, packFrame, toHex } from "./frame";
import { IconAlert, IconCheck, IconCopy, IconPlay } from "./icons";
import { createSessionLookup, createVolunteerLookup } from "./ids";
import { demoKeyFor } from "./keyring";
import { Waveform } from "./Waveform";

interface SendDoorProps {
  active: boolean;
  plan: EventPlan;
  /** Newest plan version this device knows about. */
  latestOffset: number;
  audio: BrowserAudio;
  protocol: ProtocolName;
  onProtocol(protocol: ProtocolName): void;
}

type Pick = "ready" | "not-ready" | null;

const SEQ_KEY = (volunteerId: string) => `doorsopen.acoustic.seq.${volunteerId}`;
const readSeq = (volunteerId: string) => {
  try {
    return Number(localStorage.getItem(SEQ_KEY(volunteerId))) || 0;
  } catch {
    return 0;
  }
};
const writeSeq = (volunteerId: string, seq: number) => {
  try {
    localStorage.setItem(SEQ_KEY(volunteerId), String(seq));
  } catch {
    /* ignore: the counter then restarts at 1 next time, which listeners may flag as a duplicate */
  }
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export function SendDoor({ active, plan, latestOffset, audio, protocol, onProtocol }: SendDoorProps) {
  const [volunteerId, setVolunteerId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pick, setPick] = useState<Pick>(null);

  const [offsetText, setOffsetText] = useState("");
  const [breakSeal, setBreakSeal] = useState(false);

  const [engine, setEngine] = useState<AudioEngine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [samples, setSamples] = useState<Float32Array | null>(null);

  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [seqs, setSeqs] = useState<Record<string, number>>({});
  const [burst, setBurst] = useState(0);

  const volunteers = useMemo(() => createVolunteerLookup(plan.volunteers), [plan.volunteers]);
  const sessions = useMemo(() => createSessionLookup(plan.sessions), [plan.sessions]);

  // Forget a choice if the plan changed underneath it.
  useEffect(() => {
    if (volunteerId && volunteers.toNumber(volunteerId) === undefined) setVolunteerId(null);
    if (sessionId && sessions.toNumber(sessionId) === undefined) setSessionId(null);
  }, [volunteers, sessions, volunteerId, sessionId]);

  // Load the sound engine once this door is open (and again if the speed changes).
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setEngine(null);
    setEngineError(null);
    audio
      .prepare(protocol)
      .then((loaded) => !cancelled && setEngine(loaded))
      .catch((error: unknown) => !cancelled && setEngineError(error instanceof Error ? error.message : "The sound engine could not start."));
    return () => {
      cancelled = true;
    };
  }, [active, audio, protocol]);

  const nextSeq = volunteerId ? (seqs[volunteerId] ?? readSeq(volunteerId)) + 1 : null;
  const parsedOffset = offsetText.trim() === "" ? null : Number(offsetText);
  const offsetInvalid = parsedOffset !== null && (!Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 0xffffffff);
  const planSeen = parsedOffset !== null && !offsetInvalid ? parsedOffset : latestOffset;

  const volunteerNumber = volunteerId ? volunteers.toNumber(volunteerId) : undefined;
  const sessionNumber = sessionId ? sessions.toNumber(sessionId) : undefined;
  const complete = volunteerId && volunteerNumber !== undefined && sessionNumber !== undefined && pick !== null && nextSeq !== null && !offsetInvalid;

  /** The real, sealed 16 bytes once everything is chosen. */
  const frame = useMemo(() => {
    if (!complete || !volunteerId) return null;
    const bytes = packFrame(
      { volunteer: volunteerNumber!, session: sessionNumber!, basedOnOffset: planSeen, seq: nextSeq!, status: pick === "ready" ? 1 : 0 },
      demoKeyFor(volunteerId),
    );
    if (breakSeal) bytes[FRAME_LENGTH - 1] ^= 0xff; // test mode: the receiver should call this "Can't verify"
    return bytes;
  }, [complete, volunteerId, volunteerNumber, sessionNumber, planSeen, nextSeq, pick, breakSeal]);

  const frameHex = frame ? toHex(frame) : "";

  /** Ribbon contents: fills in as choices are made. */
  const ribbonBytes = useMemo<(number | null)[]>(() => {
    if (frame) return Array.from(frame);
    const out: (number | null)[] = Array(FRAME_LENGTH).fill(null);
    const put = (start: number, length: number, value: number) => {
      for (let i = 0; i < length; i++) out[start + i] = (value / 256 ** (length - 1 - i)) & 0xff;
    };
    const field = (id: string) => FIELD_LAYOUT.find((f) => f.id === id)!;
    out[0] = (FRAME_VERSION << 4) | MESSAGE_TYPE_STATUS;
    if (volunteerNumber !== undefined) put(field("who").start, 2, volunteerNumber);
    if (sessionNumber !== undefined) put(field("session").start, 2, sessionNumber);
    if (!offsetInvalid) put(field("plan").start, 4, planSeen);
    if (nextSeq !== null) put(field("count").start, 2, nextSeq);
    if (pick !== null) out[field("status").start] = pick === "ready" ? 1 : 0;
    return out;
  }, [frame, volunteerNumber, sessionNumber, planSeen, offsetInvalid, nextSeq, pick]);

  // Turn the message into real sound as soon as it is complete, so the wave you see is the wave you will hear.
  const [encodeError, setEncodeError] = useState<string | null>(null);
  useEffect(() => {
    if (!engine || !frame) {
      setSamples(null);
      return;
    }
    try {
      setSamples(engine.encode(frame));
      setEncodeError(null);
    } catch (error) {
      setSamples(null);
      setEncodeError(error instanceof Error ? error.message : "Could not make the sound.");
    }
    // frameHex stands in for `frame`, which changes identity on every render pass
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, frameHex]);

  const raf = useRef(0);
  const play = async () => {
    if (!engine || !samples || !frame || !volunteerId || playing) return;
    setPlaying(true);
    setSentNote(null);
    const startedAt = performance.now();
    const duration = (samples.length / engine.sampleRate) * 1000;
    const tick = () => {
      setProgress(Math.min(1, (performance.now() - startedAt) / duration));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    try {
      await audio.play(samples, engine.sampleRate);
      const used = nextSeq!;
      writeSeq(volunteerId, used);
      setSeqs((current) => ({ ...current, [volunteerId]: used }));
      setSentNote(`Sent as message #${used}. If the organiser did not hear it, move closer and play again.`);
      setBurst((n) => n + 1);
      navigator.vibrate?.(40);
    } catch (error) {
      setEncodeError(error instanceof Error ? error.message : "The sound could not be played.");
    } finally {
      cancelAnimationFrame(raf.current);
      setProgress(null);
      setPlaying(false);
    }
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const explain = useMemo(
    () => (id: Parameters<typeof explainField>[0]) =>
      explainField(id, {
        volunteerNumber,
        volunteerName: plan.volunteers.find((v) => v.id === volunteerId)?.name,
        sessionNumber,
        sessionTitle: plan.sessions.find((s) => s.id === sessionId)?.title,
        planSeen: offsetInvalid ? undefined : planSeen,
        seq: nextSeq ?? undefined,
        status: pick === null ? undefined : pick === "ready" ? 1 : 0,
        seal: frame ? (breakSeal ? "broken" : "matches") : "pending",
      }),
    [plan, volunteerId, volunteerNumber, sessionId, sessionNumber, offsetInvalid, planSeen, nextSeq, pick, frame, breakSeal],
  );

  // Keyboard shortcuts: R = ready, N = not ready, P = play (ignored while typing in a field).
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "r") setPick("ready");
      else if (key === "n") setPick("not-ready");
      else if (key === "p") void playRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  const missing = [!volunteerId && "your name", !sessionId && "a session", pick === null && "a status"].filter(Boolean) as string[];
  const venueName = (venueId: string) => plan.venues.find((v) => v.id === venueId)?.name ?? "";
  const seconds = samples && engine ? Math.max(1, Math.round(samples.length / engine.sampleRate)) : null;
  const problem = engineError ?? encodeError;

  const copyHex = async () => {
    try {
      await navigator.clipboard.writeText(frameHex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked: the hex is still selectable on screen */
    }
  };

  return (
    <div className="ac-split">
      <div className="ac-choices">
        <section className="ac-step" aria-labelledby="ac-s1">
          <h3 id="ac-s1"><span className="ac-step-n">1</span>Who are you?</h3>
          <div className="ac-chips" role="radiogroup" aria-labelledby="ac-s1">
            {plan.volunteers.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={volunteerId === v.id} className="ac-chip" data-on={volunteerId === v.id} onClick={() => setVolunteerId(v.id)}>
                <span className="ac-avatar">{initials(v.name)}</span>
                <span className="ac-chip-copy"><strong>{v.name}</strong><small>{v.role}</small></span>
              </button>
            ))}
            {!plan.volunteers.length && <p className="ac-empty">No volunteers in this plan yet. Import a schedule first.</p>}
          </div>
        </section>

        <section className="ac-step" aria-labelledby="ac-s2">
          <h3 id="ac-s2"><span className="ac-step-n">2</span>Which session?</h3>
          <div className="ac-sessions" role="radiogroup" aria-labelledby="ac-s2">
            {plan.sessions.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={sessionId === s.id} className="ac-session" data-on={sessionId === s.id} onClick={() => setSessionId(s.id)}>
                <span className="ac-session-time">{formatTime(s.start)}</span>
                <span className="ac-session-copy"><strong>{s.title}</strong><small>{venueName(s.venueId)}</small></span>
                {sessionId === s.id && <IconCheck width={16} height={16} />}
              </button>
            ))}
            {!plan.sessions.length && <p className="ac-empty">No sessions in this plan yet.</p>}
          </div>
        </section>

        <section className="ac-step" aria-labelledby="ac-s3">
          <h3 id="ac-s3"><span className="ac-step-n">3</span>How are things?</h3>
          <div className="ac-status-pair" role="radiogroup" aria-labelledby="ac-s3">
            <button type="button" role="radio" aria-checked={pick === "ready"} className="ac-status ac-status-ready" data-on={pick === "ready"} onClick={() => setPick("ready")}>
              <IconCheck width={22} height={22} />Ready
            </button>
            <button type="button" role="radio" aria-checked={pick === "not-ready"} className="ac-status ac-status-notready" data-on={pick === "not-ready"} onClick={() => setPick("not-ready")}>
              <IconAlert width={22} height={22} />Not ready
            </button>
          </div>
          <p className="ac-keys">Shortcuts: <kbd>R</kbd> ready, <kbd>N</kbd> not ready, <kbd>P</kbd> play.</p>
        </section>
      </div>

      <aside className="ac-signal" aria-label="The sound you will send">
        <Waveform mode={samples ? "playback" : "idle"} accent="#8b7cff" samples={samples} progress={progress} />
        <ByteRibbon bytes={ribbonBytes} state={frame ? (breakSeal ? "rejected" : "verified") : "idle"} sweep={progress} explain={explain} />
        <p className="ac-signal-note">
          {frame
            ? `These 16 bytes are the whole message${seconds ? `, about ${seconds} seconds of sound` : ""}. The seal proves it came from you.`
            : "Your choices fill in the message as you go. When it is complete it is sealed and turned into sound."}
        </p>

        <div className="ac-play-wrap" data-playing={playing}>
          <i className="ac-play-ring" /><i className="ac-play-ring ac-play-ring-2" />
          <button type="button" className="ac-play" onClick={play} disabled={!frame || !samples || playing || !!problem}>
            <IconPlay width={20} height={20} />
            {playing ? "Playing…" : "Play check-in sound"}
          </button>
          <Burst trigger={burst} tone="violet" />
        </div>

        <p className="ac-hint" role="status" aria-live="polite">
          {problem ? (
            <span className="ac-error"><IconAlert width={15} height={15} />{problem}</span>
          ) : sentNote ? (
            <span className="ac-ok"><IconCheck width={15} height={15} />{sentNote}</span>
          ) : missing.length ? (
            `Still needed: ${missing.join(", ")}.`
          ) : !engine ? (
            "Warming up the sound engine…"
          ) : (
            "Hold this device near the organiser’s laptop, then press play."
          )}
        </p>

        <details className="ac-advanced">
          <summary>Advanced options</summary>
          <label className="ac-field-row">
            <span>Plan version this device has seen</span>
            <input inputMode="numeric" value={offsetText} placeholder={String(latestOffset)} onChange={(e) => setOffsetText(e.target.value)} aria-invalid={offsetInvalid} />
            <small>{offsetInvalid ? "Use a whole number, 0 or higher." : "Leave blank to use the newest. A lower number tests the “Out of date” result."}</small>
          </label>
          <label className="ac-field-row">
            <span>Sound speed</span>
            <select value={protocol} onChange={(e) => onProtocol(e.target.value as ProtocolName)}>
              <option value="normal">Normal (more reliable)</option>
              <option value="fast">Fast (shorter)</option>
            </select>
            <small>The listening laptop must use the same speed.</small>
          </label>
          <label className="ac-check">
            <input type="checkbox" checked={breakSeal} onChange={(e) => setBreakSeal(e.target.checked)} />
            <span>Break the seal on purpose, to test “Can’t verify”</span>
          </label>
          {frame && (
            <div className="ac-hexrow">
              <code>{frameHex}</code>
              <button type="button" className="ac-ghost" onClick={copyHex}>{copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}{copied ? "Copied" : "Copy"}</button>
            </div>
          )}
        </details>
      </aside>
    </div>
  );
}
