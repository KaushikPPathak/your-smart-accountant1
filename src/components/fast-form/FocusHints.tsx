import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Hint = string;

interface Ctx {
  zones: Record<string, Hint[]>;
  setHints: (zone: string, hints: Hint[]) => void;
  clearHints: (zone: string) => void;
}

const FocusHintsCtx = createContext<Ctx | null>(null);

const DEFAULT_HINTS: Hint[] = [
  "Enter: next",
  "Esc: back",
  "Ctrl+S: accept",
  "F3: new ledger",
  "F4: new item",
  "Alt+L: ledger report",
];

export function FocusHintsProvider({ children }: { children: ReactNode }) {
  const [zones, setZones] = useState<Record<string, Hint[]>>({});
  const setHints = useCallback((zone: string, hints: Hint[]) => {
    setZones((cur) => ({ ...cur, [zone]: hints }));
  }, []);
  const clearHints = useCallback((zone: string) => {
    setZones((cur) => {
      if (!(zone in cur)) return cur;
      const next = { ...cur }; delete next[zone]; return next;
    });
  }, []);
  const value = useMemo(() => ({ zones, setHints, clearHints }), [zones, setHints, clearHints]);
  return <FocusHintsCtx.Provider value={value}>{children}</FocusHintsCtx.Provider>;
}

export function useCurrentHints(): Hint[] {
  const ctx = useContext(FocusHintsCtx);
  if (!ctx) return DEFAULT_HINTS;
  // Pick the most recently set zone (last key in insertion order).
  const keys = Object.keys(ctx.zones);
  if (keys.length === 0) return DEFAULT_HINTS;
  const lastKey = keys[keys.length - 1];
  return ctx.zones[lastKey] ?? DEFAULT_HINTS;
}

export function useFocusHints() {
  const ctx = useContext(FocusHintsCtx);
  return ctx ?? { zones: {}, setHints: () => {}, clearHints: () => {} };
}
