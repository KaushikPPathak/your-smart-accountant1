import { useCallback, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

interface Options {
  orientation?: "horizontal" | "vertical" | "both";
  /** Wrap from last->first / first->last. Default true. */
  loop?: boolean;
  /**
   * Selector matching focusable items inside the scope root. Defaults to any
   * element tagged with `data-focus-item="true"`.
   */
  itemSelector?: string;
}

/**
 * Roving-tabindex helper for a focus scope. Wire the returned `onKeyDown` to
 * the scope root; put `data-focus-item="true"` (or a custom selector) on each
 * navigable child. Arrow keys / Home / End move focus deterministically.
 *
 * Enter, Tab, and Escape are intentionally NOT handled here — those are owned
 * by the global engine and by form-specific handlers.
 */
export function useFocusScope<T extends HTMLElement>(
  ref: RefObject<T>,
  opts: Options = {},
) {
  const orientation = opts.orientation ?? "horizontal";
  const loop = opts.loop ?? true;
  const selector = opts.itemSelector ?? '[data-focus-item="true"]';

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      const root = ref.current;
      if (!root) return;
      const key = e.key;
      const wantH = orientation !== "vertical";
      const wantV = orientation !== "horizontal";
      const isPrev = (wantH && key === "ArrowLeft") || (wantV && key === "ArrowUp");
      const isNext = (wantH && key === "ArrowRight") || (wantV && key === "ArrowDown");
      if (!isPrev && !isNext && key !== "Home" && key !== "End") return;

      const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
      );
      if (items.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const idx = active ? items.indexOf(active) : -1;
      if (idx === -1) return;

      e.preventDefault();
      let next = idx;
      if (isNext) next = idx + 1;
      else if (isPrev) next = idx - 1;
      else if (key === "Home") next = 0;
      else if (key === "End") next = items.length - 1;

      if (loop) next = (next + items.length) % items.length;
      else next = Math.max(0, Math.min(items.length - 1, next));

      items[next]?.focus();
    },
    [ref, orientation, loop, selector],
  );

  return { onKeyDown };
}
