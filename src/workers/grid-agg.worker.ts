// Web Worker that runs data-grid processing and pivot aggregation off the main thread.
/// <reference lib="webworker" />

import { computePivot, type PivotConfig, type PivotRecord, type PivotResult } from "../components/data-grid/pivot-engine";
import { processRows, deriveEnumValues, type FlatRow } from "../components/data-grid/grid-engine";
import type { DGColumn, GridState } from "../components/data-grid/types";

export interface GridRequest {
  id: number;
  kind: "process";
  rows: any[];
  columns: DGColumn<any>[];
  state: GridState;
  expandedGroups: Set<string>;
  globalSearchAccessor?: string; // Serialized function placeholder
}

export interface PivotRequest {
  id: number;
  kind: "pivot";
  records: PivotRecord[];
  config: PivotConfig;
}

export type WorkerRequest = GridRequest | PivotRequest;

export interface GridResponse {
  id: number;
  ok: true;
  kind: "process";
  flat: FlatRow<any>[];
  aggregates: Record<string, number>;
  visibleCount: number;
  enums: Record<string, string[]>;
  ms: number;
}

export interface PivotResponse {
  id: number;
  ok: true;
  kind: "pivot";
  result: PivotResult;
  ms: number;
}

export interface WorkerError {
  id: number;
  ok: false;
  error: string;
}

export type WorkerResponse = GridResponse | PivotResponse | WorkerError;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (evt: MessageEvent<WorkerRequest>) => {
  const msg = evt.data;
  const t0 = performance.now();
  try {
    if (msg.kind === "pivot") {
      const result = computePivot(msg.records, msg.config);
      const res: PivotResponse = { id: msg.id, ok: true, kind: "pivot", result, ms: performance.now() - t0 };
      ctx.postMessage(res);
    } else if (msg.kind === "process") {
      // For the worker, we assume the accessors are already simple strings or pre-mapped
      const result = processRows(msg.rows, msg.columns, msg.state, msg.expandedGroups);
      
      const enums: Record<string, string[]> = {};
      for (const c of msg.columns) {
        if (c.type === "enum") enums[c.id] = deriveEnumValues(msg.rows, c);
      }

      const res: GridResponse = { 
        id: msg.id, 
        ok: true, 
        kind: "process", 
        ...result, 
        enums,
        ms: performance.now() - t0 
      };
      ctx.postMessage(res);
    }
  } catch (e) {
    const err: WorkerError = { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    ctx.postMessage(err);
  }
};

export {};
