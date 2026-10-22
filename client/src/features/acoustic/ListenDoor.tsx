import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EventPlan } from "../doorsopen/types";
import { ByteRibbon } from "./ByteRibbon";
import type { BrowserAudio, ListenHandle, ProtocolName } from "./audio";
import { Burst, CountUp } from "./Delight";
import { explainField } from "./explain";
import { fromHex, packFrame, toHex } from "./frame";
import { IconAlert, IconCheck, IconChevron, IconMic, IconPlay, IconStop } from "./icons";
import { createSessionLookup, createVolunteerLookup } from "./ids";
import { demoKeyFor } from "./keyring";
import { classifyFrame, createLedger, recordVerdict, type Classification, type Ledger, type Lookups, type VerdictKind } from "./rules";
import { describeHeard, statusWord, VERDICTS } from "./verdicts";
import { Waveform } from "./Waveform";

interface ListenDoorProps {
  active: boolean;
  plan: EventPlan;
  sessionOffsets: Record<string, number>;
  audio: BrowserAudio;
  protocol: ProtocolName;
  onProtocol(protocol: ProtocolName): void;
  /** True when the event log is reachable. */
  canRecord: boolean;
  record(type: string, payload: Record<string, unknown>): Promise<void>;
}

interface HeardItem {
  id: number;
  at: Date;
  bytes: Uint8Array;
  result: Classification;
  volunteer?: string;
  session?: string;
  saved?: "saved" | "failed";
  /** Made by "Run a demo": never saved, no sound involved. */
  simulated?: boolean;
}

/** The three result tiles. They also work as filters. */
type Group = "good" | "held" | "bad";
const groupOf = (kind: VerdictKind): Group => (kind === "accepted" ? "good" : kind === "forged" ? "bad" : "held");

const LEVEL_HISTORY = 160;
const timeOf = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function ListenDoor({ active, plan, sessionOffsets, audio, protocol, onProtocol, canRecord, record }: ListenDoorProps) {
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<HeardItem[]>([]);
  const [filter, setFilter] = useState<Group | "all">("all");
  const [saveToLog, setSaveToLog] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);

  const handle = useRef<ListenHandle | null>(null);
  const levels = useRef<number[]>(Array(LEVEL_HISTORY).fill(0));
  const ear = useRef<HTMLDivElement>(null);
  const ledger = useRef(createLedger());
  const nextId = useRef(1);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const volunteers = useMemo(() => createVolunteerLookup(plan.volunteers), [plan.volunteers]);
  const sessions = useMemo(() => createSessionLookup(plan.sessions), [plan.sessions]);

  const lookups = useMemo<Lookups>(
    () => ({
      getKey: (n) => {
        const id = volunteers.toId(n);
        return id ? demoKeyFor(id) : undefined;
      },
      sessionIdFor: (n) => sessions.toId(n),
      latestOffsetFor: (n) => {
        const id = sessions.toId(n);
        return id ? (sessionOffsets[id] ?? 0) : 0;
      },
    }),
    [volunteers, sessions, sessionOffsets],
  );

  // The microphone callback must always see the newest plan without restarting the microphone.
  const live = useRef({ lookups, plan, saveToLog, canRecord, record, volunteers, sessions });
  live.current = { lookups, plan, saveToLog, canRecord, record, volunteers, sessions };

  /** Checks one heard message, lists it, and (for real ones only) optionally saves the outcome to the event log. */
  const ingest = useCallback((bytes: Uint8Array, options: { simulated?: boolean; ledger?: Ledger } = {}) => {
    const { lookups: lk, plan: p, volunteers: vt, sessions: st } = live.current;
    const book = options.ledger ?? ledger.current;
    const result = classifyFrame(bytes, book, lk);
    recordVerdict(book, result);

    const volunteerId = result.frame ? vt.toId(result.frame.volunteer) : undefined;
    const sessionId = result.frame ? st.toId(result.frame.session) : undefined;
    const item: HeardItem = {
      id: nextId.current++,
      at: new Date(),
      bytes,
      result,
      volunteer: p.volunteers.find((v) => v.id === volunteerId)?.name,
      session: p.sessions.find((s) => s.id === sessionId)?.title,
      simulated: options.simulated,
    };
    setHeard((list) => [item, ...list].slice(0, 100));

    // Optionally write the outcome to the event log, using the event types that already exist there.
    const { saveToLog: save, canRecord: reachable, record: write } = live.current;
    if (!options.simulated && save && reachable && result.frame && volunteerId && sessionId) {
      const payload = {
        volunteerId,
        sessionId,
        basedOnOffset: result.frame.basedOnOffset,
        seq: result.frame.seq,
        status: result.frame.status === 1 ? "ready" : "not-ready",
      };
      const type =
        result.kind === "accepted" ? "ConfirmationAccepted" : result.kind === "stale" ? "StaleConfirmationFlagged" : result.kind === "forged" ? "ConfirmationRejected" : null;
      if (type) {
        write(type, type === "ConfirmationAccepted" ? payload : { ...payload, reason: result.reason })
          .then(() => setHeard((list) => list.map((x) => (x.id === item.id ? { ...x, saved: "saved" } : x))))
          .catch(() => setHeard((list) => list.map((x) => (x.id === item.id ? { ...x, saved: "failed" } : x))));
      }
    }
  }, []);

  const handleFrame = useCallback((bytes: Uint8Array) => ingest(bytes), [ingest]);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    levels.current.fill(0);
    ear.current?.style.setProperty("--lvl", "0");
    setListening(false);
  }, []);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      handle.current = await audio.listen(protocol, {
        onFrame: handleFrame,
        onLevel: (level) => {
          const history = levels.current;
          history.push(level);
          if (history.length > LEVEL_HISTORY) history.shift();
          ear.current?.style.setProperty("--lvl", level.toFixed(3));
        },
      });
      setListening(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the microphone.");
    } finally {
      setStarting(false);
    }
  };

  // Stop the microphone when this door closes, the speed changes, or the page goes away.
  useEffect(() => {
    if (!active) stop();
  }, [active, stop]);
  useEffect(() => {
    if (handle.current) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocol]);
  useEffect(
    () => () => {
      handle.current?.stop();
      demoTimers.current.forEach(clearTimeout);
    },
    [],
  );

  /**
   * "Run a demo": plays a made-up sequence of volunteers through the REAL checks (no sound, nothing saved),
   * so you can see every verdict without a second device.
   */
  const canDemo = plan.volunteers.length > 0 && plan.sessions.length > 0;
  const runDemo = () => {
    if (!canDemo || demoRunning) return;
    const vols = plan.volunteers.slice(0, 3);
    const sess = plan.sessions.slice(0, 3);
    const pickV = (i: number) => vols[i % vols.length];
    const pickS = (i: number) => sess[i % sess.length];
    const make = (v: (typeof vols)[number], s: (typeof sess)[number], seq: number, status: 0 | 1, basedOnOffset: number, breakSeal = false) => {
      const bytes = packFrame({ volunteer: volunteers.toNumber(v.id)!, session: sessions.toNumber(s.id)!, basedOnOffset, seq, status }, demoKeyFor(v.id));
      if (breakSeal) bytes[bytes.length - 1] ^= 0xff;
      return bytes;
    };
    const fresh = (s: (typeof sess)[number]) => sessionOffsets[s.id] ?? 0;
    const changed = plan.sessions.find((s) => (sessionOffsets[s.id] ?? 0) > 0);

    const first = make(pickV(0), pickS(0), 5, 1, fresh(pickS(0)));
    const steps: Uint8Array[] = [
      first,
      make(pickV(1), pickS(1), 3, 0, fresh(pickS(1))),
      first, // the same message again: "Already heard"
      make(pickV(0), pickS(0), 4, 1, fresh(pickS(0))), // older message number after #5: "Out of order"
      ...(changed ? [make(pickV(2), changed, 2, 1, Math.max(0, (sessionOffsets[changed.id] ?? 1) - 1))] : []), // saw an older plan: "Out of date"
      make(pickV(1), pickS(0), 9, 1, fresh(pickS(0)), true), // broken seal: "Can’t verify"
    ];

    const demoLedger = createLedger(); // separate from the real one, so a demo never affects real messages
    setDemoRunning(true);
    setFilter("all");
    steps.forEach((bytes, i) => {
      demoTimers.current.push(setTimeout(() => ingest(bytes, { simulated: true, ledger: demoLedger }), 500 + i * 1300));
    });
    demoTimers.current.push(setTimeout(() => setDemoRunning(false), 500 + steps.length * 1300));
  };

  const checkPasted = () => {
    const bytes = fromHex(pasted);
    if (!bytes) {
      setPasteError("That is not valid hex. Paste the 32 characters shown under “Advanced options” on the Send side.");
      return;
    }
    setPasteError(null);
    handleFrame(bytes);
    setPasted("");
  };

  const counts = useMemo(() => {
    const c: Record<Group, number> = { good: 0, held: 0, bad: 0 };
    for (const item of heard) c[groupOf(item.result.kind)] += 1;
    return c;
  }, [heard]);

  const latest = heard[0];
  const shown = filter === "all" ? heard : heard.filter((item) => groupOf(item.result.kind) === filter);
  const latestBytes = latest ? Array.from(latest.bytes) : Array(16).fill(null);
  const latestTone = latest ? VERDICTS[latest.result.kind].tone : "none";

  const explain = useMemo(() => {
    const frame = latest?.result.frame;
    return (id: Parameters<typeof explainField>[0]) =>
      explainField(id, {
        volunteerNumber: frame?.volunteer,
        volunteerName: latest?.volunteer,
        sessionNumber: frame?.session,
        sessionTitle: latest?.session,
        planSeen: frame?.basedOnOffset,
        seq: frame?.seq,
        status: frame?.status,
        seal: latest ? (latest.result.kind === "forged" ? "broken" : "matches") : "pending",
      });
  }, [latest]);

  const tiles: { group: Group; label: string; hint: string }[] = [
    { group: "good", label: "Recorded", hint: "Checked and counted" },
    { group: "held", label: "Held back", hint: "Old, repeated or out of order" },
    { group: "bad", label: "Rejected", hint: "Seal did not match" },
  ];

  return (
    <div className="ac-split">
      <div className="ac-ear" ref={ear}>
        <div className="ac-sonar" data-on={listening}>
          <i className="ac-ring ac-ring-1" /><i className="ac-ring ac-ring-2" /><i className="ac-ring ac-ring-3" />
          <button type="button" className="ac-sonar-btn" onClick={listening ? stop : start} disabled={starting} aria-pressed={listening}>
            {listening ? <IconStop width={30} height={30} /> : <IconMic width={30} height={30} />}
            <span>{starting ? "Starting…" : listening ? "Stop" : "Start listening"}</span>
          </button>
        </div>

        <Waveform mode={listening ? "live" : "idle"} accent="#52e0d0" levelsRef={levels} height={92} />

        <p className="ac-hint" role="status" aria-live="polite">
          {error ? (
            <span className="ac-error"><IconAlert width={15} height={15} />{error}</span>
          ) : listening ? (
            "Listening. Ask a volunteer to press Play near this laptop’s microphone."
          ) : (
            "Press the button, allow the microphone, then keep this page open."
          )}
        </p>

        <div className="ac-demo">
          <button type="button" className="ac-demo-btn" onClick={runDemo} disabled={!canDemo || demoRunning}>
            <IconPlay width={16} height={16} />
            {demoRunning ? "Running the demo…" : "Run a demo"}
          </button>
          <small>Simulated volunteers go through the real checks. No sound, nothing is saved.</small>
        </div>

        <label className="ac-toggle" data-disabled={!canRecord}>
          <input type="checkbox" checked={saveToLog && canRecord} disabled={!canRecord} onChange={(e) => setSaveToLog(e.target.checked)} />
          <span className="ac-toggle-track"><i /></span>
          <span className="ac-toggle-copy">
            <strong>Save results to the event log</strong>
            <small>{canRecord ? "Recorded, out-of-date and rejected messages are added as events." : "Not available: the event log is not connected."}</small>
          </span>
        </label>

        <details className="ac-advanced">
          <summary>Advanced options</summary>
          <label className="ac-field-row">
            <span>Sound speed</span>
            <select value={protocol} onChange={(e) => onProtocol(e.target.value as ProtocolName)}>
              <option value="normal">Normal (more reliable)</option>
              <option value="fast">Fast (shorter)</option>
            </select>
            <small>Must match the sender.</small>
          </label>
          <label className="ac-field-row">
            <span>Try a message without sound</span>
            <textarea rows={2} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste 32 hex characters, e.g. 11 0001 0002 …" spellCheck={false} />
            <small>{pasteError ?? "Useful for testing the checks when no microphone is handy."}</small>
          </label>
          <button type="button" className="ac-ghost" onClick={checkPasted} disabled={!pasted.trim()}>Check this message</button>
        </details>
      </div>

      <div className="ac-results">
        <div className="ac-tiles" role="group" aria-label="Results so far. Choose one to filter the list.">
          {tiles.map((tile) => (
            <button
              key={tile.group}
              type="button"
              className="ac-tile"
              data-group={tile.group}
              data-on={filter === tile.group}
              aria-pressed={filter === tile.group}
              onClick={() => setFilter((current) => (current === tile.group ? "all" : tile.group))}
            >
              <span className="ac-tile-num"><CountUp value={counts[tile.group]} /></span>
              <span className="ac-tile-label">{tile.label}</span>
              <small>{tile.hint}</small>
            </button>
          ))}
        </div>

        <section className="ac-latest" aria-live="polite" aria-label="Latest message" data-tone={latestTone}>
          {latest ? (
            <>
              <div className="ac-latest-head">
                <span className="ac-badge-wrap">
                  <span className="ac-badge" data-tone={VERDICTS[latest.result.kind].tone}>{VERDICTS[latest.result.kind].label}</span>
                  <Burst trigger={latest.id} tone={VERDICTS[latest.result.kind].tone} />
                </span>
                <span className="ac-latest-meta">
                  {latest.simulated && <span className="ac-demo-tag">Demo</span>}
                  <time>{timeOf(latest.at)}</time>
                </span>
              </div>
              <p className="ac-latest-line">{describeHeard(latest.result, { volunteer: latest.volunteer, session: latest.session })}</p>
              <ByteRibbon bytes={latestBytes} state={latest.result.kind === "forged" ? "rejected" : "verified"} scrambleKey={latest.id} explain={explain} />
              <p className="ac-latest-why">{latest.result.reason}</p>
              {latest.saved && <p className="ac-latest-saved" data-state={latest.saved}>{latest.saved === "saved" ? "Saved to the event log." : "Could not save to the event log."}</p>}
            </>
          ) : (
            <>
              <p className="ac-latest-line ac-latest-wait">Nothing heard yet.</p>
              <ByteRibbon bytes={latestBytes} />
              <p className="ac-latest-why">When a volunteer plays their sound, the message decodes here and gets a verdict. No second device? Try “Run a demo”.</p>
            </>
          )}
        </section>

        <section className="ac-feed" aria-label="Everything heard">
          {heard.length > 0 && (
            <div className="ac-feed-head">
              <span>{filter === "all" ? "Everything heard" : tiles.find((t) => t.group === filter)?.label}</span>
              <button type="button" className="ac-filter ac-filter-clear" onClick={() => { setHeard([]); setFilter("all"); ledger.current = createLedger(); }}>Clear</button>
            </div>
          )}
          <ul className="ac-list">
            {shown.map((item) => (
              <li key={item.id}>
                <details className="ac-row" data-tone={VERDICTS[item.result.kind].tone}>
                  <summary>
                    <span className="ac-badge ac-badge-sm" data-tone={VERDICTS[item.result.kind].tone}>{VERDICTS[item.result.kind].label}</span>
                    <span className="ac-row-line">{describeHeard(item.result, { volunteer: item.volunteer, session: item.session })}</span>
                    <time>{timeOf(item.at)}</time>
                    <IconChevron width={14} height={14} className="ac-row-chevron" />
                  </summary>
                  <div className="ac-row-body">
                    <p>{item.result.reason}</p>
                    <dl>
                      {item.result.frame && <><dt>Message #</dt><dd>{item.result.frame.seq}</dd><dt>Plan seen</dt><dd>version {item.result.frame.basedOnOffset}</dd><dt>Status</dt><dd>{statusWord(item.result.frame.status)}</dd></>}
                      {item.simulated && <><dt>Source</dt><dd>Demo (no sound)</dd></>}
                      <dt>Raw bytes</dt><dd><code>{toHex(item.bytes)}</code></dd>
                    </dl>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {!shown.length && heard.length > 0 && <p className="ac-empty">Nothing in this group yet.</p>}
        </section>
      </div>
    </div>
  );
}
