/**
 * Small floating calculator, summoned by keyboard (Ctrl+Alt+C) from anywhere
 * in the app. Answer-key history + copy-to-clipboard, keypad also driven by
 * the keyboard (digits, + - * / . Enter Backspace Esc).
 *
 * Kept intentionally minimal — this is a scratch pad, not a spreadsheet.
 * The parser accepts +, -, *, /, %, parentheses, and decimals; anything
 * else is rejected so we never eval() user input.
 */
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Delete } from "lucide-react";
import { toast } from "sonner";

function safeEval(expr: string): number | null {
  const cleaned = expr.replace(/\s+/g, "");
  if (!cleaned) return null;
  if (!/^[0-9+\-*/().%]+$/.test(cleaned)) return null;
  try {
    // Replace trailing "%" like "1000*18%" → "1000*18/100".
    const withPct = cleaned.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${withPct})`)();
    return typeof val === "number" && Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

const KEYS: Array<{ label: string; value: string; variant?: "op" | "eq" | "clr" }> = [
  { label: "C", value: "C", variant: "clr" },
  { label: "(", value: "(" },
  { label: ")", value: ")" },
  { label: "÷", value: "/", variant: "op" },

  { label: "7", value: "7" },
  { label: "8", value: "8" },
  { label: "9", value: "9" },
  { label: "×", value: "*", variant: "op" },

  { label: "4", value: "4" },
  { label: "5", value: "5" },
  { label: "6", value: "6" },
  { label: "−", value: "-", variant: "op" },

  { label: "1", value: "1" },
  { label: "2", value: "2" },
  { label: "3", value: "3" },
  { label: "+", value: "+", variant: "op" },

  { label: "0", value: "0" },
  { label: ".", value: "." },
  { label: "%", value: "%" },
  { label: "=", value: "=", variant: "eq" },
];

interface HistoryItem { expr: string; result: number }

export function CalculatorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [expr, setExpr] = useState("");
  const [result, setResult] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      // Focus after Radix mounts the content.
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Live preview as user types.
  useEffect(() => {
    setResult(safeEval(expr));
  }, [expr]);

  function press(v: string) {
    if (v === "C") { setExpr(""); setResult(null); return; }
    if (v === "=") { commit(); return; }
    setExpr((s) => s + v);
    inputRef.current?.focus();
  }

  function commit() {
    const r = safeEval(expr);
    if (r === null) return;
    setHistory((h) => [{ expr, result: r }, ...h].slice(0, 20));
    setExpr(String(r));
    setResult(r);
  }

  function copy(v: number) {
    void navigator.clipboard?.writeText(String(v)).then(
      () => toast.success(`Copied ${v}`),
      () => toast.error("Copy failed"),
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); commit(); return; }
    if (e.key === "Escape") return; // let Radix close
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-4">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Calculator</DialogTitle>
          <DialogDescription className="text-xs">
            Type an expression or use the keypad. Enter = evaluate · Esc = close.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-2">
          <input
            ref={inputRef}
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. 1000 * 18% + 250"
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-lg outline-none focus:ring-2 focus:ring-ring"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex items-center justify-between text-right font-mono text-2xl tabular-nums">
            <span className="text-xs text-muted-foreground">=</span>
            <span className={result === null ? "text-muted-foreground" : "text-foreground"}>
              {result === null ? "—" : Number(result.toFixed(6)).toString()}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {KEYS.map((k) => (
              <Button
                key={k.label}
                type="button"
                variant={k.variant === "eq" ? "default" : k.variant === "op" ? "secondary" : "outline"}
                size="sm"
                className="h-10 font-mono text-base"
                onClick={() => press(k.value)}
                tabIndex={-1}
              >
                {k.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="flex-1"
              disabled={result === null}
              onClick={() => result !== null && copy(result)}
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy result
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setExpr((s) => s.slice(0, -1))}
              tabIndex={-1}
              aria-label="Backspace"
            >
              <Delete className="h-4 w-4" />
            </Button>
          </div>

          {history.length > 0 && (
            <div className="mt-2 max-h-32 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs font-mono">
              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">History</div>
              {history.map((h, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => copy(h.result)}
                  className="flex w-full items-center justify-between py-0.5 hover:bg-accent/50 rounded px-1"
                  title="Click to copy result"
                >
                  <span className="text-muted-foreground truncate">{h.expr}</span>
                  <span className="ml-2 tabular-nums">{Number(h.result.toFixed(6)).toString()}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
