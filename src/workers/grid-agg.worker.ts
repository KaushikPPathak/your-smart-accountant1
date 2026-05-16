// Web Worker that runs pivot aggregation off the main thread.
// Vite imports this with `?worker` and bundles it as a module worker.
/// <reference lib="webworker" />

import { computePivot, type PivotConfig, type PivotRecord, type PivotResult } from "../components/data-grid/pivot-engine";

export interface PivotRequest {
  id: number;
  kind: "pivot";
  records: PivotRecord[];
  config: PivotConfig;
}
export interface PivotResponse {
  id: number;
  ok: true;
  kind: "pivot";
  result: PivotResult;
  ms: number;
}
export interface PivotError {
  id: number;
  ok: false;
  error: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (evt: MessageEvent<PivotRequest>) => {
  const msg = evt.data;
  const t0 = performance.now();
  try {
    if (msg.kind === "pivot") {
      const result = computePivot(msg.records, msg.config);
      const res: PivotResponse = { id: msg.id, ok: true, kind: "pivot", result, ms: performance.now() - t0 };
      ctx.postMessage(res);
    }
  } catch (e) {
    const err: PivotError = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(err);
  }
};

export {};
