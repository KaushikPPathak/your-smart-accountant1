/**
 * Print DOM preparation bus.
 *
 * Screen-optimised widgets (virtualised grids, scroll containers) cannot be
 * cloned straight into a print document — only the handful of rows that are
 * currently mounted would appear. Before the print engine clones the report
 * subtree it fires `report:print-prepare`; any component that has a
 * print-specific representation renders it (hidden on screen, revealed by the
 * preview stylesheet) and the engine clones afterwards. `report:print-cleanup`
 * tears the extra DOM down again.
 */
import * as React from "react";

const PREPARE = "report:print-prepare";
const CLEANUP = "report:print-cleanup";

/** True while the print engine is capturing the DOM. */
export function usePrintPreparing(): boolean {
  const [on, setOn] = React.useState(false);
  React.useEffect(() => {
    const start = () => setOn(true);
    const end = () => setOn(false);
    window.addEventListener(PREPARE, start);
    window.addEventListener(CLEANUP, end);
    return () => {
      window.removeEventListener(PREPARE, start);
      window.removeEventListener(CLEANUP, end);
    };
  }, []);
  return on;
}

/** Ask every print-aware component to render its print representation. */
export async function preparePrintDom(): Promise<void> {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PREPARE));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  // Extra tick so large print tables finish committing before the clone.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 30));
}

/** Drop the print-only DOM again. */
export function endPrintDom(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CLEANUP));
}
