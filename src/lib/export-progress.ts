// Lightweight non-blocking progress toast for large report exports.
// Uses sonner (already used throughout the app) so it matches existing UX.
import { toast } from "sonner";

export interface ExportProgress {
  update(rowsDone: number, stage?: string): void;
  done(): void;
  fail(message?: string): void;
}

const fmt = (n: number): string => n.toLocaleString("en-IN");

/**
 * Show a persistent toast for a long-running export. Returns handles to
 * update progress and dismiss it. Only shows the toast when the payload is
 * large enough to be worth surfacing (>5k rows) — smaller exports finish
 * in a fraction of a second and don't need UI feedback.
 */
export function showExportProgress(fileName: string, totalRows: number): ExportProgress {
  const showToast = totalRows >= 5_000;
  const id = showToast
    ? toast.loading(`Preparing ${fileName}…`, {
        description: `0 / ${fmt(totalRows)} rows`,
        duration: Infinity,
      })
    : undefined;

  let lastPercent = -1;
  return {
    update(rowsDone: number, stage?: string) {
      if (!showToast || id === undefined) return;
      const pct = totalRows > 0 ? Math.floor((rowsDone / totalRows) * 100) : 0;
      // Throttle updates: only when percent changes or on stage change.
      if (pct === lastPercent && !stage) return;
      lastPercent = pct;
      const stageLabel =
        stage === "writing" ? "encoding workbook" :
        stage === "preparing" ? "preparing" :
        stage?.startsWith("sheet:") ? `sheet ${stage.slice(6)}` :
        "";
      toast.loading(`Preparing ${fileName}…`, {
        id,
        description: `${fmt(rowsDone)} / ${fmt(totalRows)} rows${stageLabel ? " · " + stageLabel : ""} (${pct}%)`,
        duration: Infinity,
      });
    },
    done() {
      if (!showToast || id === undefined) return;
      toast.success(`${fileName} ready`, { id, description: `${fmt(totalRows)} rows exported`, duration: 4000 });
    },
    fail(message?: string) {
      if (!showToast || id === undefined) {
        toast.error(`Export failed: ${fileName}`, { description: message });
        return;
      }
      toast.error(`Export failed: ${fileName}`, { id, description: message, duration: 6000 });
    },
  };
}
