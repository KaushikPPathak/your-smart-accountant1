import { useEffect, useId, useRef } from "react";

import { useOptionalKeyboard } from "./KeyboardProvider";
import type { ShortcutScope } from "./types";

interface Options {
  scope?: ShortcutScope;
  allowInField?: boolean;
  enabled?: boolean;
  description?: string;
}

/**
 * Bind a keyboard shortcut. The handler ref is kept fresh across re-renders
 * so callers don't need to memoize it.
 */
export function useShortcut(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  opts: Options = {},
) {
  const kb = useOptionalKeyboard();
  const id = useId();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const enabled = opts.enabled ?? true;
  const scope = opts.scope ?? "global";
  const allowInField = opts.allowInField ?? false;
  const description = opts.description;

  useEffect(() => {
    if (!kb || !enabled) return;
    return kb.register({
      id,
      combo,
      scope,
      allowInField,
      description,
      handler: (e) => handlerRef.current(e),
    });
  }, [kb, id, combo, scope, allowInField, description, enabled]);
}
