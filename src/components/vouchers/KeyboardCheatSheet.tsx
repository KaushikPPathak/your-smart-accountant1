import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const ROWS: Array<[string, string]> = [
  ["Enter", "Move to next field"],
  ["Shift+Enter", "Move to previous field"],
  ["Esc", "Cancel / go back"],
  ["Ctrl+S", "Save voucher and start next"],
  ["Alt+S / P / R / Y / J / C / D", "New Sales / Purchase / Receipt / Payment / Journal / Credit-note / Debit-note"],
  ["Alt+L", "Jump to Ledger report"],
  ["Alt+C (in picker)", "Create new ledger/item from inside the picker"],
  ["F3 / Shift+F3", "New ledger / Edit selected ledger"],
  ["F4 / Shift+F4", "New item / Edit item on focused line"],
  ["F1", "Show this help"],
  ["Type any letter in a picker", "Open dropdown and start filtering"],
];

export function KeyboardCheatSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1 text-sm">
          {ROWS.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[200px_1fr] items-center gap-3 rounded px-2 py-1 odd:bg-muted/40">
              <kbd className="rounded border bg-background px-1.5 py-0.5 text-xs font-mono">{k}</kbd>
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          Designed for keyboard-first entry, just like Tally / Busy. Hands never leave the keyboard.
        </p>
      </DialogContent>
    </Dialog>
  );
}