import { useMemo, useState } from "react";
import type { EventPlan } from "../doorsopen/types";
import { createBrowserAudio, type BrowserAudio, type ProtocolName } from "./audio";
import { IconArrowLeft, IconMic, IconWaves } from "./icons";
import { ListenDoor } from "./ListenDoor";
import { SendDoor } from "./SendDoor";
import type { DataSource } from "./useAcousticData";
import "./acoustic.css";

export interface AcousticViewProps {
  plan: EventPlan;
  latestOffset: number;
  sessionOffsets: Record<string, number>;
  source: DataSource;
  canRecord: boolean;
  record(type: string, payload: Record<string, unknown>): Promise<void>;
  /** Swap in a different sound layer (used for previews and tests). */
  audio?: BrowserAudio;
}

type Door = "send" | "listen";

const SOURCE_TEXT: Record<DataSource, (offset: number) => string> = {
  live: (n) => `Live from the event log, version ${n}`,
  saved: (n) => `Offline: using the plan saved on this device, version ${n}`,
  sample: () => "Sample plan: the event log is not connected",
};

export function AcousticView({ plan, latestOffset, sessionOffsets, source, canRecord, record, audio }: AcousticViewProps) {
  const [door, setDoor] = useState<Door>("send");
  const [protocol, setProtocol] = useState<ProtocolName>("normal");
  const engine = useMemo(() => audio ?? createBrowserAudio(), [audio]);

  return (
    <div className="ac-root" data-door={door}>
      <header className="ac-top">
        <a className="ac-back" href="/" aria-label="Back to the DoorsOpen dashboard">
          <IconArrowLeft width={16} height={16} />
          <img src="/doorsopen-mark.svg" alt="" width={22} height={22} />
          <span>Doors<em>Open</em></span>
        </a>
        <span className="ac-pill" data-source={source}><i />{SOURCE_TEXT[source](latestOffset)}</span>
      </header>

      <div className="ac-intro">
        <h1>Sound check-in</h1>
        <p>A volunteer plays a short chirp. The organiser’s laptop listens, checks the seal and records the answer, with no Wi-Fi needed at the venue.</p>
      </div>

      <main className="ac-stage" data-open={door}>
        <section className="ac-door ac-door-send" data-open={door === "send"} aria-label="Send my status">
          <button type="button" className="ac-door-tab" onClick={() => setDoor("send")} tabIndex={door === "send" ? -1 : 0} aria-hidden={door === "send"}>
            <IconWaves width={22} height={22} />
            <span>Send my status</span>
          </button>
          <div className="ac-door-body" inert={door !== "send"}>
            <div className="ac-door-head">
              <h2>Send my status</h2>
              <p>For volunteers. Say who you are and how things are, then let your device speak it.</p>
            </div>
            <SendDoor active={door === "send"} plan={plan} latestOffset={latestOffset} audio={engine} protocol={protocol} onProtocol={setProtocol} />
          </div>
        </section>

        <section className="ac-door ac-door-listen" data-open={door === "listen"} aria-label="Listen for statuses">
          <button type="button" className="ac-door-tab" onClick={() => setDoor("listen")} tabIndex={door === "listen" ? -1 : 0} aria-hidden={door === "listen"}>
            <IconMic width={22} height={22} />
            <span>Listen for statuses</span>
          </button>
          <div className="ac-door-body" inert={door !== "listen"}>
            <div className="ac-door-head">
              <h2>Listen for statuses</h2>
              <p>For the organiser. Keep this open and every check-in is decoded, verified and listed.</p>
            </div>
            <ListenDoor
              active={door === "listen"}
              plan={plan}
              sessionOffsets={sessionOffsets}
              audio={engine}
              protocol={protocol}
              onProtocol={setProtocol}
              canRecord={canRecord}
              record={record}
            />
          </div>
        </section>
      </main>

      <footer className="ac-foot">
        Uses demo keys, so this proves who is speaking only against honest mistakes. Hand out private keys before a real event.
      </footer>
    </div>
  );
}
