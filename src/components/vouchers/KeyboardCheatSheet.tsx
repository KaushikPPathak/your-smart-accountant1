import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOptionalKeyboard } from "@/lib/keyboard";
import type { ShortcutBinding, ShortcutScope } from "@/lib/keyboard";

/** Static extras that aren't (yet) registered through `useShortcut`, but are
 *  still worth documenting for the user. Kept small on purpose — the source
 *  of truth is the live binding registry. */
const STATIC_ROWS: Array<{ combo: string; description: string; scope: ShortcutScope }> = [
  { combo: "Enter", description: "Move to next field", scope: "voucher" },
  { combo: "Shift+Enter", description: "Move to previous field", scope: "voucher" },
  { combo: "Tab / Shift+Tab", description: "Move to next / previous field", scope: "voucher" },
  { combo: "Esc", description: "Cancel · close overlay · go back (staged)", scope: "global" },
  { combo: "Type any letter in a picker", description: "Open dropdown and start filtering", scope: "voucher" },
  { combo: "Alt+C (in picker)", description: "Create new ledger / item from inside the picker", scope: "voucher" },
];

const SCOPE_ORDER: ShortcutScope[] = ["global", "menubar", "voucher", "report", "grid", "dialog"];
const SCOPE_LABEL: Record<ShortcutScope, string> = {
  global: "Global",
  menubar: "Menu bar",
  voucher: "Voucher entry",
  report: "Reports",
  grid: "Data grid",
  dialog: "Dialogs",
};

type Row = { combo: string; description: string; scope: ShortcutScope };

function dedupe(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const r of rows) {
    const k = `${r.scope}::${r.combo.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export function KeyboardCheatSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const kb = useOptionalKeyboard();
  const [bindings, setBindings] = React.useState<ShortcutBinding[]>([]);

  // Refresh the binding snapshot each time the sheet opens.
  React.useEffect(() => {
    if (!open || !kb) return;
    setBindings(kb.listBindings());
  }, [open, kb]);

  const grouped = React.useMemo(() => {
    const live: Row[] = bindings
      .filter((b) => b.description && b.description.trim().length > 0)
      .map((b) => ({ combo: b.combo, description: b.description!, scope: b.scope }));
    const all = dedupe([...live, ...STATIC_ROWS]);
    const byScope = new Map<ShortcutScope, Row[]>();
    for (const r of all) {
      const list = byScope.get(r.scope) ?? [];
      list.push(r);
      byScope.set(r.scope, list);
    }
    for (const list of byScope.values()) {
      list.sort((a, b) => a.combo.localeCompare(b.combo));
    }
    return SCOPE_ORDER.map((s) => [s, byScope.get(s) ?? []] as const).filter(([, rows]) => rows.length > 0);
  }, [bindings]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          {grouped.map(([scope, rows]) => (
            <div key={scope} className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {SCOPE_LABEL[scope]}
              </div>
              <div className="grid gap-1 text-sm">
                {rows.map((r, i) => (
                  <div
                    key={`${r.combo}-${i}`}
                    className="grid grid-cols-[220px_1fr] items-center gap-3 rounded px-2 py-1 odd:bg-muted/40"
                  >
                    <kbd className="rounded border bg-background px-1.5 py-0.5 text-xs font-mono">
                      {r.combo}
                    </kbd>
                    <span className="text-muted-foreground">{r.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="pt-2 text-xs text-muted-foreground">
          Auto-generated from live bindings. Descriptions come from each screen's <code>useShortcut</code> registration.
        </p>
      </DialogContent>
    </Dialog>
  );
}
