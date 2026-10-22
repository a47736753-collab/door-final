import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "./Waveform";

/** A short burst of dots from the middle of its (relatively positioned) parent. Change `trigger` to replay. */
export function Burst({ trigger, tone }: { trigger: number; tone: "good" | "warn" | "bad" | "violet" | "quiet" }) {
  if (!trigger || tone === "quiet" || prefersReducedMotion()) return null;
  const count = tone === "good" || tone === "violet" ? 20 : 10;
  return (
    <span className="ac-burst" data-tone={tone} key={trigger} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={
            {
              "--a": `${(360 / count) * i + (i % 2 ? 9 : 0)}deg`,
              "--d": `${52 + ((i * 17) % 44)}px`,
              "--s": `${4 + (i % 3) * 2}px`,
              "--t": `${(i % 4) * 35}ms`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** A number that counts up (or down) to its new value. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 650);
      const eased = 1 - (1 - k) ** 3;
      setShown(Math.round(origin + (value - origin) * eased));
      if (k < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown}</>;
}
