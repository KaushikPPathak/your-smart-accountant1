// Voice output via the Web Speech API (SpeechSynthesis).
// Free, fully offline on every modern browser, zero cloud tokens — matches
// the local-first / privacy stance of the rest of Mate.
//
// Used by the assistant for read-aloud replies and hands-free flow.

import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceOutputHook {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
  /** Register a callback fired when the current utterance finishes naturally. */
  onEnd: (cb: (() => void) | null) => void;
}

/** Strip markdown / citations / emoji clutter so the TTS engine reads the
 *  answer cleanly. Keeps digits, ₹, Dr/Cr etc. as-is. */
export function speakableText(md: string): string {
  return md
    // fenced + inline code
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    // links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // headings / list bullets / emphasis markers
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[\s>*-]+/gm, "")
    .replace(/[*_~]+/g, "")
    // citations like [V:INV-1 2025-01-01] / [L:Cash] / [F:closing]
    .replace(/\[[VLF]:[^\]]+\]/g, "")
    // squeeze whitespace
    .replace(/\s+/g, " ")
    .trim();
}

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  // Prefer en-IN / hi-IN, fall back to any English voice, then anything.
  return (
    voices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2))) ||
    voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
    voices[0] ||
    null
  );
}

export function useVoiceOutput(lang = "en-IN"): VoiceOutputHook {
  const supported =
    typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
  const [speaking, setSpeaking] = useState(false);
  const endCbRef = useRef<(() => void) | null>(null);

  // Preload the voice list — some browsers populate it asynchronously.
  useEffect(() => {
    if (!supported) return;
    const s = window.speechSynthesis;
    // Touch getVoices() once to trigger the async load in Chromium.
    s.getVoices();
    const handler = () => s.getVoices();
    s.addEventListener?.("voiceschanged", handler);
    return () => {
      try { s.cancel(); } catch { /* noop */ }
      s.removeEventListener?.("voiceschanged", handler);
    };
  }, [supported]);

  const stop = useCallback(() => {
    if (!supported) return;
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      const clean = speakableText(text);
      if (!clean) return;
      try {
        const s = window.speechSynthesis;
        s.cancel();
        const utter = new SpeechSynthesisUtterance(clean);
        const v = pickVoice(lang);
        if (v) utter.voice = v;
        utter.lang = v?.lang || lang;
        utter.rate = 1;
        utter.pitch = 1;
        utter.onstart = () => setSpeaking(true);
        utter.onend = () => {
          setSpeaking(false);
          const cb = endCbRef.current;
          if (cb) cb();
        };
        utter.onerror = () => setSpeaking(false);
        s.speak(utter);
      } catch {
        setSpeaking(false);
      }
    },
    [supported, lang],
  );

  const onEnd = useCallback((cb: (() => void) | null) => {
    endCbRef.current = cb;
  }, []);

  return { supported, speaking, speak, stop, onEnd };
}
