import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Banknote,
  BookOpen,
  Library,
  FileMinus,
  FilePlus,
  ChevronDown,
  ChevronUp,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

interface QuickAction {
  to: string;
  label: string;
  icon: LucideIcon;
  hotkey: string;
  i18nKey: string;
}

const ACTIONS: (QuickAction & { dot: string })[] = [
  { to: "/app/vouchers/new/sales", label: "Sales", icon: TrendingUp, hotkey: "Alt+S", i18nKey: "ribbon.sales", dot: "var(--cat-sales)" },
  { to: "/app/vouchers/new/purchase", label: "Purchase", icon: TrendingDown, hotkey: "Alt+P", i18nKey: "ribbon.purchase", dot: "var(--cat-purchase)" },
  { to: "/app/vouchers/new/receipt", label: "Receipt", icon: ArrowLeftRight, hotkey: "Alt+R", i18nKey: "ribbon.receipt", dot: "var(--cat-receipt)" },
  { to: "/app/vouchers/new/payment", label: "Payment", icon: Banknote, hotkey: "Alt+Y", i18nKey: "ribbon.payment", dot: "var(--cat-payment)" },
  { to: "/app/vouchers/new/credit_note", label: "Credit Note", icon: FileMinus, hotkey: "Alt+C", i18nKey: "ribbon.creditNote", dot: "var(--cat-purchase)" },
  { to: "/app/vouchers/new/debit_note", label: "Debit Note", icon: FilePlus, hotkey: "Alt+D", i18nKey: "ribbon.debitNote", dot: "var(--cat-sales)" },
  { to: "/app/vouchers/new/journal", label: "Journal", icon: BookOpen, hotkey: "Alt+J", i18nKey: "ribbon.journal", dot: "var(--cat-master)" },
  { to: "/app/reports/ledger", label: "Ledger", icon: Library, hotkey: "Alt+L", i18nKey: "ribbon.ledger", dot: "var(--cat-report)" },
];

const STORAGE_KEY = "ym_quickribbon_open";
const HOTKEY_KEY = "ym_quickribbon_hotkeys";

export function QuickActionsRibbon() {
  const location = useLocation();
  const { t } = useI18n();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; }
  });
  const [showHotkeys, setShowHotkeys] = useState<boolean>(() => {
    try { return localStorage.getItem(HOTKEY_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open]);
  useEffect(() => {
    try { localStorage.setItem(HOTKEY_KEY, showHotkeys ? "1" : "0"); } catch { /* ignore */ }
  }, [showHotkeys]);

  return (
    <div className="busy-menubar hidden md:block print:hidden">
      <div className="flex items-center gap-1 overflow-x-auto px-4 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mr-2 flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/70 hover:bg-white/10 hover:text-white"
          title={open ? "Collapse Quick Entry" : "Expand Quick Entry"}
          aria-expanded={open}
        >
          <Zap className="h-3 w-3" />
          <span>{t("ribbon.quickEntry")}</span>
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {open && ACTIONS.map((a) => {
          const active = location.pathname === a.to;
          const translated = t(a.i18nKey);
          const label = translated === a.i18nKey ? a.label : translated;
          return (
            <Link
              key={a.to}
              to={a.to}
              data-active={active}
              className="busy-menu-item"
              style={{ ["--dot" as string]: a.dot }}
              title={`${label} (${a.hotkey})`}
            >
              <span className="busy-menu-dot" />
              <a.icon className="h-3.5 w-3.5" />
              <span>{label}</span>
              {showHotkeys && (
                <kbd className="ml-1 rounded border border-white/25 bg-white/10 px-1 text-[9px] font-mono text-white/80">
                  {a.hotkey}
                </kbd>
              )}
            </Link>
          );
        })}

        {open && (
          <button
            type="button"
            onClick={() => setShowHotkeys((v) => !v)}
            className="ml-auto rounded px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 hover:text-white"
            title="Toggle keyboard shortcut hints"
          >
            {showHotkeys ? "Hide keys" : "Show keys"}
          </button>
        )}
      </div>
    </div>
  );
}
