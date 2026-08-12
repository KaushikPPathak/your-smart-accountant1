import { useCallback, useMemo, useRef } from "react";

export interface FocusManager {
  register: (name: string) => (el: HTMLElement | null) => void;
  focusByName: (name: string) => void;
  focusFirst: () => void;
  focusNext: (currentName: string) => void;
  reset: () => void; // resets values of registered native inputs to defaultValue
  getValue: (name: string) => string;
  setValue: (name: string, value: string) => void;
  getEl: (name: string) => HTMLElement | null;
}

/** Imperative focus + uncontrolled value helpers. Zero state, zero re-renders. */
export function useFocusManager(): FocusManager {
  const refs = useRef(new Map<string, HTMLElement>());

  const ordered = useCallback((): { name: string; el: HTMLElement }[] => {
    const arr: { name: string; el: HTMLElement }[] = [];
    refs.current.forEach((el, name) => { if (el.isConnected) arr.push({ name, el }); });
    arr.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return arr;
  }, []);

  return useMemo<FocusManager>(() => ({
    register: (name) => (el) => {
      if (el) refs.current.set(name, el);
      else refs.current.delete(name);
    },
    focusByName: (name) => {
      const el = refs.current.get(name);
      if (el) {
        el.focus();
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          try { el.select(); } catch { /* */ }
        }
      }
    },
    focusFirst: () => {
      const first = ordered()[0];
      if (first) first.el.focus();
    },
    focusNext: (currentName) => {
      const list = ordered();
      const idx = list.findIndex((x) => x.name === currentName);
      const next = list[idx + 1];
      if (next) {
        next.el.focus();
        if (next.el instanceof HTMLInputElement || next.el instanceof HTMLTextAreaElement) {
          try { next.el.select(); } catch { /* */ }
        }
      }
    },
    reset: () => {
      refs.current.forEach((el) => {
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = el.defaultValue;
        }
      });
    },
    getValue: (name) => {
      const el = refs.current.get(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
      return "";
    },
    setValue: (name, value) => {
      const el = refs.current.get(name);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value;
    },
    getEl: (name) => refs.current.get(name) ?? null,
  }), [ordered]);
}
