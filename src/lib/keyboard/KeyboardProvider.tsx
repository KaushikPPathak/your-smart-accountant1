import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";

import { isTypingTarget, matchCombo, parseCombo } from "./shortcuts";
import type { ShortcutBinding, ShortcutScope } from "./types";

interface KeyboardCtx {
  register: (binding: ShortcutBinding) => () => void;
  pushScope: (scope: ShortcutScope) => () => void;
  /** Snapshot current focus; call the returned fn later to restore it after
   *  React commits (queueMicrotask). Use around dialogs / route transitions. */
  saveFocus: () => () => void;
  /** Snapshot of currently-registered bindings, for cheat-sheet UIs. */
  listBindings: () => ShortcutBinding[];
}

const Ctx = createContext<KeyboardCtx | null>(null);

type Registered = ShortcutBinding & { parsed: ReturnType<typeof parseCombo> };

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const bindingsRef = useRef(new Map<string, Registered>());
  // Scope stack; deepest scope wins. "global" is always the floor.
  const scopeStackRef = useRef<ShortcutScope[]>(["global"]);

  const register = useCallback<KeyboardCtx["register"]>((binding) => {
    bindingsRef.current.set(binding.id, { ...binding, parsed: parseCombo(binding.combo) });
    return () => {
      bindingsRef.current.delete(binding.id);
    };
  }, []);

  const pushScope = useCallback<KeyboardCtx["pushScope"]>((scope) => {
    scopeStackRef.current.push(scope);
    return () => {
      const stack = scopeStackRef.current;
      const i = stack.lastIndexOf(scope);
      if (i > 0) stack.splice(i, 1); // never remove the "global" floor
    };
  }, []);

  const saveFocus = useCallback<KeyboardCtx["saveFocus"]>(() => {
    const prev = document.activeElement as HTMLElement | null;
    return () => {
      queueMicrotask(() => {
        if (prev && document.contains(prev)) {
          try { prev.focus(); } catch { /* ignore */ }
        }
      });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const stack = scopeStackRef.current;
      const activeScope = stack[stack.length - 1];
      const typing = isTypingTarget(e.target);

      // Try the active scope's bindings first, then fall back to global.
      // One allocation-free pass for the active scope, then one for global.
      // This listener runs on every keystroke, so avoid rebuilding/filtering
      // arrays on the input hot path.
      const tryScope = (scope: ShortcutScope) => {
        for (const b of bindingsRef.current.values()) {
          if (b.scope !== scope) continue;
          if (typing && !b.allowInField) continue;
          if (!matchCombo(e, b.parsed)) continue;
          b.handler(e);
          if (e.defaultPrevented) return true;
        }
        return false;
      };
      if (activeScope !== "global" && tryScope(activeScope)) return;
      if (tryScope("global")) return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const listBindings = useCallback<KeyboardCtx["listBindings"]>(() => {
    return Array.from(bindingsRef.current.values()).map((b) => ({
      id: b.id,
      combo: b.combo,
      scope: b.scope,
      allowInField: b.allowInField,
      handler: b.handler,
      description: b.description,
    }));
  }, []);

  const value = useMemo(
    () => ({ register, pushScope, saveFocus, listBindings }),
    [register, pushScope, saveFocus, listBindings],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeyboard(): KeyboardCtx {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useKeyboard must be used inside <KeyboardProvider>");
  }
  return c;
}

/** Non-throwing variant for components that may render outside the provider
 *  (e.g. standalone auth screens). Returns null when unavailable. */
export function useOptionalKeyboard(): KeyboardCtx | null {
  return useContext(Ctx);
}
