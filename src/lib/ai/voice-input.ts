// Voice input via the Web Speech API (SpeechRecognition).
// Free, offline-capable on most Chromium browsers, no external service.
// Used by the assistant composer for hands-free query entry.

import { useCallback, useEffect, useRef, useState } from "react";

type SR = typeof window extends { SpeechRecognition: infer T }
  ? T
  : any;

function getSpeechRecognitionCtor(): SR | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceInputHook {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Push-to-talk voice input. `onTranscript` fires with the final utterance
 * once the user stops speaking, so the caller can drop it into the
 * composer or send it directly.
 */
export function useVoiceInput(onTranscript: (text: string) => void, lang = "en-IN"): VoiceInputHook {
  const Ctor = getSpeechRecognitionCtor();
  const supported = !!Ctor;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<any>(null);
  const cbRef = useRef(onTranscript);
  useEffect(() => { cbRef.current = onTranscript; }, [onTranscript]);

  useEffect(() => () => {
    try { recRef.current?.stop?.(); } catch { /* ignore */ }
  }, []);

  const start = useCallback(() => {
    if (!Ctor) { setError("Voice input is not supported in this browser."); return; }
    try {
      const rec = new (Ctor as any)();
      rec.lang = lang;
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => { setListening(true); setError(null); };
      rec.onerror = (ev: any) => {
        setListening(false);
        setError(ev?.error ? `Voice error: ${ev.error}` : "Voice recognition failed.");
      };
      rec.onend = () => { setListening(false); };
      rec.onresult = (ev: any) => {
        try {
          const t = ev.results?.[0]?.[0]?.transcript ?? "";
          if (t.trim()) cbRef.current(t.trim());
        } catch { /* ignore */ }
      };
      recRef.current = rec;
      rec.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setListening(false);
    }
  }, [Ctor, lang]);

  const stop = useCallback(() => {
    try { recRef.current?.stop?.(); } catch { /* ignore */ }
    setListening(false);
  }, []);

  return { supported, listening, error, start, stop };
}
