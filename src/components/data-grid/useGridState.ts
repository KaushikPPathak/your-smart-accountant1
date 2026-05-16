import { useCallback, useEffect, useState } from "react";
import { DEFAULT_GRID_STATE, type GridState, type SavedView } from "./types";

function storageKey(reportId: string, scope: string) {
  return `dg:${reportId}:${scope}`;
}

export function useGridState(reportId: string, scope = "default") {
  const stateKey = storageKey(reportId, `${scope}:state`);
  const viewsKey = storageKey(reportId, `${scope}:views`);

  const [views, setViews] = useState<SavedView[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(viewsKey);
      if (raw) return JSON.parse(raw) as SavedView[];
    } catch { /* ignore */ }
    return [];
  });

  const [state, setState] = useState<GridState>(() => {
    if (typeof window === "undefined") return DEFAULT_GRID_STATE;
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) return { ...DEFAULT_GRID_STATE, ...JSON.parse(raw) } as GridState;
      // No saved per-session state — fall back to default view if set
      const v = JSON.parse(localStorage.getItem(viewsKey) ?? "[]") as SavedView[];
      const def = v.find((x) => x.isDefault);
      if (def) return { ...DEFAULT_GRID_STATE, ...def.state };
    } catch { /* ignore */ }
    return DEFAULT_GRID_STATE;
  });

  useEffect(() => {
    try { localStorage.setItem(stateKey, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state, stateKey]);

  const reset = useCallback(() => setState(DEFAULT_GRID_STATE), []);

  const persistViews = useCallback((next: SavedView[]) => {
    try { localStorage.setItem(viewsKey, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  }, [viewsKey]);

  const saveView = useCallback((name: string) => {
    setViews((prev) => persistViews([...prev.filter((v) => v.name !== name), { name, state }]));
  }, [state, persistViews]);

  const applyView = useCallback((name: string) => {
    const v = views.find((x) => x.name === name);
    if (v) setState({ ...DEFAULT_GRID_STATE, ...v.state });
  }, [views]);

  const deleteView = useCallback((name: string) => {
    setViews((prev) => persistViews(prev.filter((v) => v.name !== name)));
  }, [persistViews]);

  const setDefaultView = useCallback((name: string | null) => {
    setViews((prev) => persistViews(prev.map((v) => ({ ...v, isDefault: v.name === name }))));
  }, [persistViews]);

  return { state, setState, reset, views, saveView, applyView, deleteView, setDefaultView };
}
