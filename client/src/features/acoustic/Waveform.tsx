import { useEffect, useRef, type MutableRefObject } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface WaveformProps {
  /** idle: a calm line. playback: the real sound about to play. live: what the microphone hears. */
  mode: "idle" | "playback" | "live";
  accent: string;
  /** playback: the actual audio samples. */
  samples?: Float32Array | null;
  /** playback: 0..1 playhead position, or null when not playing. */
  progress?: number | null;
  /** live: rolling loudness values (0..1), newest last. Updated from outside without re-rendering. */
  levelsRef?: MutableRefObject<number[]>;
  height?: number;
}

const BAR = 3;
const GAP = 2;

/** Reduces thousands of samples to one peak value per bar. */
function peaksFor(samples: Float32Array, bars: number): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(samples.length / bars));
  const stride = Math.max(1, Math.floor(size / 24));
  let loudest = 0.0001;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    const start = b * size;
    for (let i = start; i < Math.min(samples.length, start + size); i += stride) peak = Math.max(peak, Math.abs(samples[i]));
    out.push(peak);
    loudest = Math.max(loudest, peak);
  }
  return out.map((p) => p / loudest);
}

export function Waveform({ mode, accent, samples, progress = null, levelsRef, height = 124 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: height, dpr: 1 });
  const peaksRef = useRef<number[]>([]);
  const latest = useRef({ mode, accent, samples, progress });
  latest.current = { mode, accent, samples, progress };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(wrap.clientWidth));
      sizeRef.current = { w, h: height, dpr };
      canvas.width = w * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
      const bars = Math.floor(w / (BAR + GAP));
      peaksRef.current = latest.current.samples ? peaksFor(latest.current.samples, bars) : [];
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let frame = 0;
    const reduced = prefersReducedMotion();

    const draw = (time: number) => {
      const { w, h, dpr } = sizeRef.current;
      const { mode: m, accent: color, progress: p } = latest.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const bars = Math.floor(w / (BAR + GAP));
      ctx.lineCap = "round";
      ctx.lineWidth = BAR;

      // faint centre line, so the canvas never looks empty
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, mid);
      ctx.lineTo(w, mid);
      ctx.stroke();
      ctx.lineWidth = BAR;

      for (let i = 0; i < bars; i++) {
        const x = i * (BAR + GAP) + BAR / 2;
        let amp = 0.04;
        let alpha = 0.5;

        if (m === "idle") {
          const t = reduced ? 0 : time / 1400;
          amp = 0.06 + 0.2 * (0.5 + 0.5 * Math.sin(i * 0.33 + t)) * (0.5 + 0.5 * Math.sin(i * 0.071 - t * 0.7)) * Math.sin((i / bars) * Math.PI);
          alpha = 0.32;
        } else if (m === "playback") {
          const peak = peaksRef.current[i] ?? 0;
          amp = 0.05 + peak * 0.9;
          const played = p != null && i / bars <= p;
          alpha = p == null ? 0.85 : played ? 1 : 0.3;
        } else {
          const levels = levelsRef?.current ?? [];
          const level = levels[levels.length - bars + i] ?? 0;
          amp = 0.04 + Math.min(1, level) * 0.92;
          alpha = 0.35 + Math.min(1, level) * 0.65;
        }

        const half = (h * amp) / 2;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, mid - half);
        ctx.lineTo(x, mid + half);
        ctx.stroke();
      }

      if (m === "playback" && p != null) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        const x = Math.min(w - 1, p * w);
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, h - 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const animated = (time: number) => {
      draw(time);
      frame = requestAnimationFrame(animated);
    };

    // One light loop for every mode: it always reads the newest props, so progress and levels stay smooth.
    frame = requestAnimationFrame(animated);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [samples, levelsRef, height]);

  return (
    <div ref={wrapRef} className="ac-wave" style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={mode === "live" ? "Live microphone level" : "Sound wave"} />
    </div>
  );
}
