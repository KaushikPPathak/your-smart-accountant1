import { useSyncExternalStore } from "react";

interface State {
  lastSavedLabel: string | null;
  lastSavedAt: number;
  failureCount: number;
}

const state: State = { lastSavedLabel: null, lastSavedAt: 0, failureCount: 0 };
const listeners = new Set<() => void>();
let version = 0;
function bump() { version++; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function snap() { return version; }

export function markSaved(label: string) {
  state.lastSavedLabel = label;
  state.lastSavedAt = Date.now();
  bump();
}
export function markFailure() { state.failureCount++; bump(); }
export function clearFailures() { state.failureCount = 0; bump(); }

export function useSaveStatus(): { lastSavedLabel: string | null; lastSavedAt: number } {
  useSyncExternalStore(subscribe, snap, snap);
  return { lastSavedLabel: state.lastSavedLabel, lastSavedAt: state.lastSavedAt };
}
export function useFailureCount(): number {
  useSyncExternalStore(subscribe, snap, snap);
  return state.failureCount;
}
