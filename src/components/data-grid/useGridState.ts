import { useCallback, useEffect, useState } from "react";
import { DEFAULT_GRID_STATE, type GridState, type SavedView } from "./types";

function storageKey(reportId: string, scope: string) {
  return `dg:${reportId}:${scope}`;
}

export function useGridState(reportId: string, scope = "default") {
  const stateKey = storageKey(reportId, `${scope}:state`);
  const viewsKey = storageKey(reportId, `${scope}:views`);

  const [state, setState] = useState<GridState>(() => {
    if (typeof window === "undefined") return DEFAULT_GRID_STATE;
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) return { ...DEFAULT_GRID_STATE, ...JSON.parse(raw) } as GridState;
    } catch { /* ignore */ }
    return DEFAULT_GRID_STATE;
  });

  const [views, setViews] = useState<SavedView[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(viewsKey);
      if (raw) return JSON.parse(raw) as SavedView[];
    } catch { /* ignore */ }
    return [];
  });

  useEffect(() => {
    try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state, stateKey]);

  const reset = useCallback(() => setState(DEFAULT_GRID_STATE), []);

  const saveView = useCallback((name: string) => {
    setViews((prev) => {
      const next = [...prev.filter((v) => v.name !== name), { name, state }];
      try { localStorage.setItem(viewsKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [state, viewsKey]);

  const applyView = useCallback((name: string) => {
    const v = views.find((x) => x.name === name);
    if (v) setState(v.state);
  }, [views]);

  const deleteView = useCallback((name: string) => {
    setViews((prev) => {
      const next = prev.filter((v) => v.name !== name);
      try { localStorage.setItem(viewsKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [viewsKey]);

  return { state, setState, reset, views, saveView, applyView, deleteView };
}
