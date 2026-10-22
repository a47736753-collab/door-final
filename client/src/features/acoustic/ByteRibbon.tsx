import { useEffect, useState } from "react";
import { FIELD_LAYOUT, FRAME_LENGTH, type FieldId } from "./frame";
import { prefersReducedMotion } from "./Waveform";

interface ByteRibbonProps {
  /** One entry per byte; null shows an empty slot that has not been filled in yet. */
  bytes: readonly (number | null)[];
  /** verified: the seal matches. rejected: it does not. idle: nothing to judge yet. */
  state?: "idle" | "verified" | "rejected";
  /** 0..1 position of a sweep light while the sound is playing, or null. */
  sweep?: number | null;
  /** Change this number to replay the "decoding" cascade. */
  scrambleKey?: number;
  size?: "lg" | "sm";
  showLabels?: boolean;
  /** When given, hovering or tapping a part of the message explains it underneath. */
  explain?: (id: FieldId) => string | undefined;
}

const hex = (n: number) => n.toString(16).padStart(2, "0");
const randomHex = () => hex(Math.floor(Math.random() * 256));

/**
 * The signature element of the page. The 16 bytes are the whole message, so this is
 * literally what a volunteer's device says out loud. Colours mark which part is which.
 */
export function ByteRibbon({ bytes, state = "idle", sweep = null, scrambleKey, size = "lg", showLabels = true, explain }: ByteRibbonProps) {
  const [settled, setSettled] = useState(FRAME_LENGTH);
  const [active, setActive] = useState<FieldId | null>(null);

  useEffect(() => {
    if (scrambleKey === undefined) return;
    if (prefersReducedMotion()) {
      setSettled(FRAME_LENGTH);
      return;
    }
    let count = 0;
    setSettled(0);
    const timer = setInterval(() => {
      count += 1;
      setSettled(count);
      if (count >= FRAME_LENGTH) clearInterval(timer);
    }, 55);
    return () => clearInterval(timer);
  }, [scrambleKey]);

  const filled = bytes.filter((b) => b !== null).length;
  const sealLabel = state === "verified" ? "Seal matches" : state === "rejected" ? "Seal broken" : "Seal";
  const activeField = FIELD_LAYOUT.find((f) => f.id === active);
  const hoverProps = (id: FieldId) =>
    explain
      ? {
          onMouseEnter: () => setActive(id),
          onMouseLeave: () => setActive((current) => (current === id ? null : current)),
          onFocus: () => setActive(id),
          onBlur: () => setActive((current) => (current === id ? null : current)),
          onClick: () => setActive(id),
        }
      : {};

  return (
    <div className="ac-ribbon-wrap" data-state={state}>
      <div
        className={`ac-ribbon ac-ribbon-${size}`}
        data-state={state}
        data-hovering={active !== null}
        role="group"
        aria-label={filled === FRAME_LENGTH ? "The 16 bytes of this message" : `${filled} of 16 bytes filled in`}
      >
        {FIELD_LAYOUT.map((field) => (
          <div
            className={`ac-field ac-f-${field.id}`}
            key={field.id}
            title={explain ? undefined : field.technical}
            style={{ flex: `${field.length} 1 0` }}
            data-active={active === field.id}
            tabIndex={explain ? 0 : undefined}
            {...hoverProps(field.id)}
          >
            <div className="ac-cells">
              {Array.from({ length: field.length }, (_, k) => {
                const index = field.start + k;
                const value = bytes[index];
                const scrambling = index >= settled && settled < FRAME_LENGTH;
                return (
                  <span className={`ac-cell${value == null ? " ac-cell-ghost" : ""}`} key={index}>
                    {value == null ? "··" : scrambling ? randomHex() : hex(value)}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        {sweep != null && <i className="ac-sweep" style={{ left: `${Math.min(1, Math.max(0, sweep)) * 100}%` }} />}
      </div>

      {showLabels && (
        <ul className="ac-legend">
          {FIELD_LAYOUT.map((field) => (
            <li
              className={`ac-f-${field.id}`}
              key={field.id}
              data-active={active === field.id}
              title={explain ? undefined : field.technical}
              {...(explain ? { onMouseEnter: () => setActive(field.id), onMouseLeave: () => setActive(null) } : {})}
            >
              {field.id === "seal" ? sealLabel : field.label}
            </li>
          ))}
        </ul>
      )}

      {explain && (
        <p className="ac-inspect" aria-live="polite" data-on={active !== null}>
          {activeField ? (
            <>
              <b className={`ac-f-${activeField.id}`}>{activeField.id === "seal" ? sealLabel : activeField.label}</b>
              {explain(activeField.id) ?? activeField.technical}
            </>
          ) : (
            "Hover or tap a colour to see what that part of the message says."
          )}
        </p>
      )}
    </div>
  );
}
