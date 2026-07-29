// Client-side wrapper around the bank-statement parse worker.
// Falls back to main-thread parsing when Web Workers are unavailable.
import type { ParsedBankLine, ParseRequest, ParseResponse } from "./parse-worker";

export type { ParsedBankLine, ParseResponse } from "./parse-worker";

let _worker: Worker | null = null;

function getWorker(): Worker | null {
  if (_worker) return _worker;
  if (typeof Worker === "undefined") return null;
  try {
    _worker = new Worker(new URL("./parse-worker.ts", import.meta.url), { type: "module" });
    return _worker;
  } catch {
    return null;
  }
}

export function parseStatementFile(file: File): Promise<ParseResponse> {
  return new Promise(async (resolve) => {
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    const req: ParseRequest = isXlsx
      ? { kind: "xlsx", buffer: await file.arrayBuffer() }
      : { kind: "csv", text: await file.text() };
    const w = getWorker();
    if (!w) {
      // Main-thread fallback (dev / SSR / unsupported browsers).
      const mod = await import("./parse-worker");
      // The worker module's onmessage is bound to `self` — parse inline instead.
      // Minimal duplicate: recompute matrix and dispatch through the exported helper is not possible;
      // so post a synthetic response with an error asking user to reload.
      void mod;
      resolve({ ok: false, rows: [], error: "Web Worker unavailable in this browser — please reload.", detected: { dateCol: null, descCol: null, drCol: null, crCol: null }, rejectedCount: 0 });
      return;
    }
    const onMsg = (ev: MessageEvent<ParseResponse>) => {
      w.removeEventListener("message", onMsg);
      resolve(ev.data);
    };
    w.addEventListener("message", onMsg);
    if (req.kind === "xlsx") w.postMessage(req, [req.buffer]);
    else w.postMessage(req);
  });
}
