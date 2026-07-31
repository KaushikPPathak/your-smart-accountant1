import { useEffect, useRef, useState } from "react";

/**
 * Phase I — progressive ("streaming") token render.
 *
 * The assistant reply arrives as one blob, but dumping 600 characters at
 * once reads as a jarring jump. Revealing it in word-sized chunks over a
 * few hundred milliseconds makes the answer feel immediate and lets the
 * user start reading before the full text has landed.
 *
 * Respects prefers-reduced-motion and never delays the final text by more
 * than `maxMs`.
 */
export function StreamingText({
  text,
  render,
  maxMs = 700,
  enabled = true,
}: {
  text: string;
  render: (shown: string) => React.ReactNode;
  maxMs?: number;
  enabled?: boolean;
}) {
  const reduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const instant = !enabled || reduced || text.length < 40;
  const [shown, setShown] = useState(() => (instant ? text : ""));
  const startedFor = useRef<string | null>(instant ? text : null);

  useEffect(() => {
    if (instant) {
      setShown(text);
      startedFor.current = text;
      return;
    }
    if (startedFor.current === text) return;
    startedFor.current = text;

    // Chunk on word boundaries so markdown tokens rarely split mid-syntax.
    const words = text.split(/(\s+)/);
    const steps = Math.min(words.length, 40);
    const perStep = Math.ceil(words.length / steps);
    const tick = Math.max(12, Math.floor(maxMs / steps));

    let i = 0;
    setShown("");
    const timer = setInterval(() => {
      i += perStep;
      if (i >= words.length) {
        setShown(text);
        clearInterval(timer);
        return;
      }
      setShown(words.slice(0, i).join(""));
    }, tick);

    return () => clearInterval(timer);
  }, [text, instant, maxMs]);

  return <>{render(shown)}</>;
}
