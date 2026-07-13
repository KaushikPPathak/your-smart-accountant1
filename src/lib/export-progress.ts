// Busy-style progress toast for large report exports. Shows elapsed time,
// rows/percent and a working Cancel button that terminates the underlying
// worker. Uses sonner (already used throughout the app) for consistent UX.
// Also drives the animated ExportShowcase overlay for a delightful visual.
import { toast } from "sonner";
import { openExportOverlay, type OverlayHandle } from "@/lib/export-overlay-store";

export interface ExportProgress {
  update(rowsDone: number, stage?: string): void;
  done(): void;
  fail(message?: string): void;
  cancelled(): boolean;
}

export interface ExportProgressOptions {
  /** Called when the user clicks Cancel. Should terminate the worker/abort. */
  onCancel?: () => void;
}

const fmt = (n: number): string => n.toLocaleString("en-IN");

const fmtElapsed = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rs).padStart(2, "0")}`;
};

/**
 * Show a persistent toast for a long-running export. Returns handles to
 * update progress and dismiss it. Only shows the toast when the payload is
 * large enough to be worth surfacing (>5k rows).
 */
export function showExportProgress(
  fileName: string,
  totalRows: number,
  opts: ExportProgressOptions = {},
): ExportProgress {
  const showToast = totalRows >= 5_000;
  const startedAt = Date.now();
  let isCancelled = false;
  // Always show the animated overlay — even for tiny exports — so the
  // "export" moment always feels polished.
  const overlay: OverlayHandle = openExportOverlay({
    fileName,
    total: totalRows,
    stage: "preparing",
    onCancel: opts.onCancel
      ? () => {
          isCancelled = true;
          try { opts.onCancel?.(); } catch { /* ignore */ }
          overlay.fail("Cancelled");
        }
      : undefined,
  });

  const buildDescription = (rowsDone: number, stage?: string): string => {
    const pct = totalRows > 0 ? Math.floor((rowsDone / totalRows) * 100) : 0;
    const stageLabel =
      stage === "writing" ? "encoding workbook" :
      stage === "preparing" ? "preparing" :
      stage?.startsWith("sheet:") ? `sheet ${stage.slice(6)}` :
      "";
    const elapsed = fmtElapsed(Date.now() - startedAt);
    return `${fmt(rowsDone)} / ${fmt(totalRows)} rows${stageLabel ? " · " + stageLabel : ""} · ${pct}% · ${elapsed} elapsed`;
  };

  const id = showToast
    ? toast.loading(`Exporting ${fileName}…`, {
        description: buildDescription(0),
        duration: Infinity,
        action: opts.onCancel
          ? {
              label: "Cancel",
              onClick: () => {
                isCancelled = true;
                try { opts.onCancel?.(); } catch { /* ignore */ }
                toast.error(`Export cancelled: ${fileName}`, { id, duration: 3000 });
              },
            }
          : undefined,
      })
    : undefined;

  let lastPercent = -1;
  let lastStage = "";
  return {
    cancelled() { return isCancelled; },
    update(rowsDone: number, stage?: string) {
      if (isCancelled) return;
      const pct = totalRows > 0 ? Math.floor((rowsDone / totalRows) * 100) : 0;
      if (pct === lastPercent && stage === lastStage) return;
      lastPercent = pct;
      lastStage = stage ?? "";
      // Update the animated overlay every tick.
      overlay.update({ done: rowsDone, stage });
      if (!showToast || id === undefined) return;
      toast.loading(`Exporting ${fileName}…`, {
        id,
        description: buildDescription(rowsDone, stage),
        duration: Infinity,
        action: opts.onCancel
          ? {
              label: "Cancel",
              onClick: () => {
                isCancelled = true;
                try { opts.onCancel?.(); } catch { /* ignore */ }
                overlay.fail("Cancelled");
                toast.error(`Export cancelled: ${fileName}`, { id, duration: 3000 });
              },
            }
          : undefined,
      });
    },
    done() {
      if (isCancelled) return;
      overlay.done();
      if (!showToast || id === undefined) return;
      const elapsed = fmtElapsed(Date.now() - startedAt);
      toast.success(`${fileName} ready`, {
        id,
        description: `${fmt(totalRows)} rows exported in ${elapsed}`,
        duration: 4000,
      });
    },
    fail(message?: string) {
      if (isCancelled) return;
      overlay.fail(message);
      if (!showToast || id === undefined) {
        toast.error(`Export failed: ${fileName}`, { description: message });
        return;
      }
      toast.error(`Export failed: ${fileName}`, { id, description: message, duration: 6000 });
    },
  };
}
