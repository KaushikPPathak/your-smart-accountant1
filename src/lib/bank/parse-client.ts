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

const EMPTY_DETECTED = { dateCol: null, descCol: null, drCol: null, crCol: null } as ParseResponse["detected"];

async function readRequest(file: File): Promise<ParseRequest> {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  return isXlsx
    ? { kind: "xlsx", buffer: await file.arrayBuffer() }
    : { kind: "csv", text: await file.text() };
}

function sendToWorker(w: Worker, req: ParseRequest): Promise<ParseResponse> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener("message", onMsg);
      w.removeEventListener("error", onErr);
    };
    const onMsg = (ev: MessageEvent<ParseResponse>) => { cleanup(); resolve(ev.data); };
    const onErr = (ev: ErrorEvent) => { cleanup(); reject(new Error(ev.message || "parser worker failed")); };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    if (req.kind === "xlsx") w.postMessage(req, [req.buffer]);
    else w.postMessage(req);
  });
}

/**
 * Parse a bank statement. Always settles: read errors, a missing worker and
 * worker crashes all come back as `{ ok: false, error }` instead of hanging.
 */
export function parseStatementFile(file: File): Promise<ParseResponse> {
  const fail = (error: string): ParseResponse => ({
    ok: false, rows: [], error, detected: EMPTY_DETECTED, rejectedCount: 0,
  });
  return readRequest(file)
    .then((req) => {
      const w = getWorker();
      if (!w) return fail("Web Worker unavailable in this browser — please reload.");
      return sendToWorker(w, req);
    })
    .catch((e: unknown) => fail(`Could not read file: ${e instanceof Error ? e.message : String(e)}`));
}
