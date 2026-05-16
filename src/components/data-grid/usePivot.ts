import { useEffect, useMemo, useRef, useState } from "react";
import { computePivot, type PivotConfig, type PivotRecord, type PivotResult } from "./pivot-engine";
import type { DGColumn } from "./types";

// Run heavy pivots in a worker. Falls back to main-thread for small jobs or when Workers are unavailable.
const WORKER_THRESHOLD = 5000;

let _worker: Worker | null = null;
let _reqId = 0;
const _pending = new Map<number, (r: { ok: true; result: PivotResult } | { ok: false; error: string }) => void>();

function getWorker(): Worker | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL("../../workers/grid-agg.worker.ts", import.meta.url), { type: "module" });
    _worker.onmessage = (e: MessageEvent) => {
      const data = e.data as { id: number; ok: boolean; result?: PivotResult; error?: string };
      const cb = _pending.get(data.id);
      if (!cb) return;
      _pending.delete(data.id);
      if (data.ok && data.result) cb({ ok: true, result: data.result });
      else cb({ ok: false, error: data.error ?? "Worker error" });
    };
    _worker.onerror = () => {
      for (const [id, cb] of _pending) cb({ ok: false, error: "Worker crashed" });
      _pending.clear();
      _worker = null;
    };
  } catch {
    _worker = null;
  }
  return _worker;
}

function runInWorker(records: PivotRecord[], config: PivotConfig): Promise<PivotResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) {
      resolve(computePivot(records, config));
      return;
    }
    const id = ++_reqId;
    _pending.set(id, (r) => (r.ok ? resolve(r.result) : reject(new Error(r.error))));
    w.postMessage({ id, kind: "pivot", records, config });
  });
}

export interface UsePivotArgs<T> {
  rows: T[];
  columns: DGColumn<T>[];
  config: PivotConfig;
  /** when true, compute the pivot */
  enabled: boolean;
}

export interface UsePivotState {
  result: PivotResult | null;
  loading: boolean;
  error: string | null;
  /** ms elapsed for the last computation */
  ms: number;
}

export function usePivot<T>({ rows, columns, config, enabled }: UsePivotArgs<T>): UsePivotState {
  const colsById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);

  // Pre-extract the slim record set the pivot actually needs (rows + cols + values fields).
  const records = useMemo<PivotRecord[]>(() => {
    if (!enabled) return [];
    const fields = new Set<string>([...config.rows, ...config.cols, ...config.values.map((v) => v.id)]);
    const accessors: Array<[string, (row: T) => unknown]> = [];
    for (const f of fields) {
      const col = colsById.get(f);
      if (col) accessors.push([f, col.accessor]);
    }
    const out: PivotRecord[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const rec: PivotRecord = {};
      const r = rows[i];
      for (const [k, acc] of accessors) {
        const v = acc(r);
        rec[k] = v == null ? null : (typeof v === "number" ? v : String(v));
      }
      out[i] = rec;
    }
    return out;
  }, [rows, colsById, enabled, config.rows, config.cols, config.values]);

  const [state, setState] = useState<UsePivotState>({ result: null, loading: false, error: null, ms: 0 });
  const reqRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ result: null, loading: false, error: null, ms: 0 });
      return;
    }
    const myReq = ++reqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t0 = performance.now();

    const run = async () => {
      try {
        const result = records.length >= WORKER_THRESHOLD
          ? await runInWorker(records, config)
          : computePivot(records, config);
        if (myReq !== reqRef.current) return;
        setState({ result, loading: false, error: null, ms: performance.now() - t0 });
      } catch (e) {
        if (myReq !== reqRef.current) return;
        setState({ result: null, loading: false, error: e instanceof Error ? e.message : String(e), ms: 0 });
      }
    };
    run();
  }, [records, config, enabled]);

  return state;
}
