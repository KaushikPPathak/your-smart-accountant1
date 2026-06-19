import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertTriangle, Wrench, X } from "lucide-react";
import { isTauriRuntime, safeBrainExec } from "./SqliteBrain";

type ErrorDictEntry = { msg: string; fix: string };

const LOCAL_ERROR_DICT: Record<string, ErrorDictEntry> = {
  SQLITE_BUSY: { msg: "Database busy hai", fix: "Ek second ruko, dobara try hoga" },
  SQLITE_LOCKED: { msg: "File lock hai", fix: "App band karke dobara kholein" },
  SQLITE_FULL: { msg: "Disk full ho gaya", fix: "C: drive mein space khaali karein" },
  SQLITE_CORRUPT: { msg: "Data corrupt ho sakta hai", fix: "Backup se restore karein" },
  VOUCHER_INCOMPLETE: { msg: "Voucher incomplete hai", fix: "Debit = Credit hona chahiye" },
  LEDGER_MISSING: { msg: "Ledger nahi mila", fix: "Masters mein ledger banayein" },
  PARTY_NOT_FOUND: { msg: "Party nahi mili", fix: "Party naam check karein" },
  GST_MISMATCH: { msg: "GST amount galat hai", fix: "Tax ledger dobara select karein" },
  STOCK_NEGATIVE: { msg: "Stock negative ho raha hai", fix: "Opening stock check karein" },
  REPORT_NO_DATA: { msg: "Report mein kuch nahi", fix: "Date range ya company badlein" },
  TAURI_IPC_ERROR: { msg: "App error", fix: "Window band karke dobara kholein" },
  COMPONENT_CRASH: { msg: "Screen load nahi hui", fix: "App restart karein" },
};

function classifyError(message: string): string {
  const m = message.toUpperCase();
  if (m.includes("SQLITE_BUSY")) return "SQLITE_BUSY";
  if (m.includes("SQLITE_LOCKED") || m.includes("DATABASE IS LOCKED")) return "SQLITE_LOCKED";
  if (m.includes("DISK FULL") || m.includes("SQLITE_FULL")) return "SQLITE_FULL";
  if (m.includes("CORRUPT") || m.includes("MALFORMED")) return "SQLITE_CORRUPT";
  if (m.includes("TAURI") || m.includes("IPC")) return "TAURI_IPC_ERROR";
  if (m.includes("LEDGER")) return "LEDGER_MISSING";
  if (m.includes("PARTY")) return "PARTY_NOT_FOUND";
  if (m.includes("GST")) return "GST_MISMATCH";
  if (m.includes("STOCK")) return "STOCK_NEGATIVE";
  if (m.includes("VOUCHER")) return "VOUCHER_INCOMPLETE";
  return "COMPONENT_CRASH";
}

interface ErrorToast {
  id: number;
  code: string;
  msg: string;
  fix: string;
  fixAction: () => void;
}

interface ErrorBrainContextValue {
  logBrainError: (
    code: string,
    message: string,
    component: string,
    action?: string,
  ) => Promise<void>;
}

const ErrorBrainContext = createContext<ErrorBrainContextValue | null>(null);

export function useErrorBrain(): ErrorBrainContextValue {
  const ctx = useContext(ErrorBrainContext);
  if (!ctx) {
    return {
      logBrainError: async () => {
        // no-op fallback outside provider
      },
    };
  }
  return ctx;
}

export function ErrorBrainProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ErrorToast | null>(null);
  const toastIdRef = useRef(0);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((code: string, fixAction: () => void) => {
    const entry = LOCAL_ERROR_DICT[code] ?? LOCAL_ERROR_DICT.COMPONENT_CRASH;
    const id = ++toastIdRef.current;
    setToast({ id, code, msg: entry.msg, fix: entry.fix, fixAction });
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setToast((t) => (t && t.id === id ? null : t));
    }, 5000);
  }, []);

  const logBrainError = useCallback<ErrorBrainContextValue["logBrainError"]>(
    async (code, message, component, action) => {
      const normalizedCode = LOCAL_ERROR_DICT[code] ? code : classifyError(message || code);
      const timestamp = new Date().toISOString();
      if (isTauriRuntime()) {
        await safeBrainExec(
          `INSERT INTO brain_error_log (timestamp, error_code, error_message, component, action_attempted, auto_fixed, fix_applied)
           VALUES ($1, $2, $3, $4, $5, 0, $6)`,
          [
            timestamp,
            normalizedCode,
            message,
            component,
            action ?? "",
            LOCAL_ERROR_DICT[normalizedCode]?.fix ?? "",
          ],
        );
      }
      showToast(normalizedCode, () => {
        if (typeof window !== "undefined") window.location.reload();
      });
    },
    [showToast],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isExtensionNoise = (text: string, stack?: string, filename?: string) => {
      const hay = `${text}\n${stack ?? ""}\n${filename ?? ""}`;
      return (
        hay.includes("chrome-extension://") ||
        hay.includes("moz-extension://") ||
        hay.includes("frame_ant") ||
        hay.includes("injected.js")
      );
    };

    const onError = (event: ErrorEvent) => {
      const message = event.message || (event.error ? String(event.error) : "Unknown error");
      const stack = event.error instanceof Error ? event.error.stack : undefined;
      if (isExtensionNoise(message, stack, event.filename)) return;
      void logBrainError(classifyError(message), message, "window.onerror");
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unhandled rejection";
      const stack = reason instanceof Error ? reason.stack : undefined;
      if (isExtensionNoise(message, stack)) return;
      void logBrainError(classifyError(message), message, "window.onunhandledrejection");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [logBrainError]);

  return (
    <ErrorBrainContext.Provider value={{ logBrainError }}>
      {children}
      {toast && (
        <div
          className="fixed bottom-4 left-4 z-[9999] w-[340px] rounded-lg border-2 border-orange-500 bg-black text-white shadow-2xl"
          role="alert"
        >
          <div className="flex items-start gap-3 p-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-400" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-orange-300">{toast.msg}</div>
              <div className="mt-1 text-xs text-white/80">{toast.fix}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/40">
                {toast.code}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex justify-end gap-2 border-t border-white/10 p-2">
            <button
              type="button"
              onClick={() => {
                toast.fixAction();
                setToast(null);
              }}
              className="inline-flex items-center gap-1 rounded bg-green-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-green-400"
            >
              <Wrench className="h-3.5 w-3.5" />
              Fix
            </button>
          </div>
        </div>
      )}
    </ErrorBrainContext.Provider>
  );
}
