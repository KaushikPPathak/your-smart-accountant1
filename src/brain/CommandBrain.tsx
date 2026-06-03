import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Command, Search, History } from "lucide-react";
import { isTauriRuntime, safeBrainExec, safeBrainSelect } from "./SqliteBrain";
import { useSpeedBrain } from "./SpeedBrain";

interface CommandHistoryRow {
  id: number;
  command_text: string;
  matched_action: string;
  executed_at: string;
}

interface CommandBrainContextValue {
  openPalette: () => void;
  closePalette: () => void;
}

const CommandBrainContext = createContext<CommandBrainContextValue>({
  openPalette: () => {},
  closePalette: () => {},
});

export function useCommandBrain(): CommandBrainContextValue {
  return useContext(CommandBrainContext);
}

function fuzzyFind<T extends { name: string }>(items: T[], query: string): T | null {
  if (!query) return null;
  const q = query.toLowerCase();
  let best: { item: T; score: number } | null = null;
  for (const it of items) {
    const n = (it.name || "").toLowerCase();
    if (!n) continue;
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(q)) score = 60;
    else {
      const tokens = q.split(/\s+/).filter(Boolean);
      const matched = tokens.filter((t) => n.includes(t)).length;
      if (matched > 0) score = 20 + matched * 5;
    }
    if (score > 0 && (!best || score > best.score)) best = { item: it, score };
  }
  return best?.item ?? null;
}

function extractAmount(input: string): number | null {
  const m = input.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

export function CommandBrainProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<CommandHistoryRow[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const { CACHE } = useSpeedBrain();

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => {
    setOpen(false);
    setInput("");
  }, []);

  const loadHistory = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const rows = await safeBrainSelect<CommandHistoryRow>(
      `SELECT id, command_text, matched_action, executed_at FROM brain_command_history ORDER BY executed_at DESC LIMIT 10`,
    );
    setHistory(rows);
  }, []);

  useEffect(() => {
    if (open) {
      void loadHistory();
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, loadHistory]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        closePalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closePalette]);

  const logCommand = useCallback(async (text: string, action: string) => {
    if (!isTauriRuntime()) return;
    await safeBrainExec(
      `INSERT INTO brain_command_history (command_text, matched_action, executed_at) VALUES ($1, $2, $3)`,
      [text, action, new Date().toISOString()],
    );
  }, []);

  const runCommand = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text) return;
      const lower = text.toLowerCase();
      let action = "unknown";

      const navTo = (path: string, label: string) => {
        action = label;
        try {
          navigate({ to: path as never });
        } catch {
          if (typeof window !== "undefined") window.location.hash = `#${path}`;
        }
      };

      if (lower.includes("gstr-1") || lower.includes("gstr1")) {
        navTo("/app/reports/gstr1", "report:gstr1");
      } else if (lower.includes("gstr-3b") || lower.includes("gstr3b")) {
        navTo("/app/reports/gstr3b", "report:gstr3b");
      } else if (lower.includes("balance sheet")) {
        navTo("/app/reports/balance-sheet", "report:balance-sheet");
      } else if (lower.includes("daybook") || lower.includes("din ki bahi") || lower.includes("day book")) {
        navTo("/app/reports/day-book", "report:day-book");
      } else if (lower.includes("balance") || lower.includes("kitna")) {
        const target = lower.replace(/balance|kitna/g, "").trim();
        const ledger = fuzzyFind(CACHE.ledgers, target);
        if (ledger) {
          const rows = await safeBrainSelect<{ bal: number | null }>(
            `SELECT SUM(amount) as bal FROM voucher_entries WHERE ledger_id = ?`,
            [ledger.id],
          );
          const bal = rows[0]?.bal ?? 0;
          toast.success(`${ledger.name}: ₹ ${Number(bal).toLocaleString("en-IN")}`);
          action = `balance:${ledger.id}`;
        } else {
          toast.error("Ledger nahi mila");
          action = "balance:not-found";
        }
      } else if (lower.includes("sale") || lower.includes("bikri")) {
        const amount = extractAmount(text);
        const party = fuzzyFind(CACHE.parties, lower.replace(/sale|bikri|\d+(\.\d+)?/g, "").trim());
        navTo("/app/vouchers/new/sales", "voucher:sales");
        if (amount || party) {
          toast.message("Sales draft", {
            description: `${party?.name ?? "Party?"} • ₹ ${amount ?? "?"}`,
          });
        }
      } else if (lower.includes("purchase") || lower.includes("kharidi")) {
        navTo("/app/vouchers/new/purchase", "voucher:purchase");
      } else if (lower.includes("receipt") || lower.includes("paisa aaya")) {
        navTo("/app/vouchers/new/receipt", "voucher:receipt");
      } else if (lower.includes("payment") || lower.includes("paisa gaya")) {
        navTo("/app/vouchers/new/payment", "voucher:payment");
      } else {
        toast.error(`Command samajh nahi aaya: "${text}"`);
      }

      await logCommand(text, action);
      closePalette();
    },
    [CACHE.ledgers, CACHE.parties, navigate, logCommand, closePalette],
  );

  const value = useMemo(() => ({ openPalette, closePalette }), [openPalette, closePalette]);

  return (
    <CommandBrainContext.Provider value={value}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[9998] flex items-start justify-center bg-black/70 pt-24"
          onClick={closePalette}
        >
          <div
            className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-orange-500/40 bg-zinc-950 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Command className="h-4 w-4 text-orange-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-orange-300">
                Mehtaji Command
              </span>
              <span className="ml-auto text-[10px] text-white/40">Ctrl + Space</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-3">
              <Search className="h-4 w-4 text-white/40" />
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runCommand(input);
                }}
                placeholder="Try: sale 5000 acme  |  balance cash  |  gstr-1  |  daybook"
                className="w-full bg-transparent text-sm text-white placeholder-white/30 outline-none"
              />
            </div>
            {history.length > 0 && (
              <div className="max-h-64 overflow-auto border-t border-white/10">
                <div className="flex items-center gap-2 px-3 py-2 text-[10px] uppercase tracking-wider text-white/40">
                  <History className="h-3 w-3" />
                  Recent
                </div>
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => void runCommand(h.command_text)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <span className="truncate text-white/90">{h.command_text}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-white/40">
                      {h.matched_action}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </CommandBrainContext.Provider>
  );
}
