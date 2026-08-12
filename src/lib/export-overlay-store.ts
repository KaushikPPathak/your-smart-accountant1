// Tiny publish/subscribe store that drives the global ExportShowcase overlay.
// Kept out of React state so any code (workers, lib helpers, non-component
// modules) can trigger a beautiful export animation.
export interface ExportOverlayState {
  fileName: string;
  done: number;
  total: number;
  stage?: string;
  startedAt: number;
  status: "running" | "done" | "failed";
  onCancel?: () => void;
  dismiss: () => void;
}

type Listener = (s: ExportOverlayState | null) => void;

let current: ExportOverlayState | null = null;
const listeners = new Set<Listener>();

const emit = () => {
  for (const l of listeners) l(current);
};

export function subscribeExportOverlay(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => { listeners.delete(l); };
}

export interface OverlayHandle {
  update(patch: Partial<Pick<ExportOverlayState, "done" | "total" | "stage" | "fileName">>): void;
  done(): void;
  fail(message?: string): void;
  dismiss(): void;
}

export function openExportOverlay(init: {
  fileName: string;
  total?: number;
  stage?: string;
  onCancel?: () => void;
}): OverlayHandle {
  const dismiss = () => { current = null; emit(); };
  current = {
    fileName: init.fileName,
    done: 0,
    total: init.total ?? 0,
    stage: init.stage,
    startedAt: Date.now(),
    status: "running",
    onCancel: init.onCancel,
    dismiss,
  };
  emit();

  return {
    update(patch) {
      if (!current) return;
      current = { ...current, ...patch };
      emit();
    },
    done() {
      if (!current) return;
      current = { ...current, status: "done", done: current.total || current.done };
      emit();
      // Auto-dismiss after a short celebration window.
      window.setTimeout(() => { if (current?.status === "done") dismiss(); }, 1400);
    },
    fail(message?: string) {
      if (!current) return;
      current = { ...current, status: "failed", stage: message };
      emit();
      window.setTimeout(() => { if (current?.status === "failed") dismiss(); }, 3500);
    },
    dismiss,
  };
}
