import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { useFocusScope } from "@/lib/keyboard";

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
  const ribbonId = useId();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== "0"; } catch { return true; }
  });
  const [showHotkeys, setShowHotkeys] = useState<boolean>(() => {
    try { return localStorage.getItem(HOTKEY_KEY) === "1"; } catch { return false; }
  });
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const scope = useFocusScope(toolbarRef, { orientation: "horizontal", loop: true });

  // Roving tabindex is applied imperatively (not through React state) so an
  // arrow keypress never triggers a re-render. One item carries tabIndex=0;
  // the rest are -1. The active id is mirrored to aria-activedescendant via
  // a DOM attribute write instead of setState.
  const activeIdRef = useRef<string>(`${ribbonId}-toggle`);
  const applyRoving = (nextId: string) => {
    const root = toolbarRef.current;
    if (!root) return;
    activeIdRef.current = nextId;
    root.setAttribute("aria-activedescendant", nextId);
    const items = root.querySelectorAll<HTMLElement>("[data-focus-item='true']");
    items.forEach((el) => {
      el.tabIndex = el.id === nextId ? 0 : -1;
    });
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open]);
  useEffect(() => {
    try { localStorage.setItem(HOTKEY_KEY, showHotkeys ? "1" : "0"); } catch { /* ignore */ }
  }, [showHotkeys]);

  // Re-apply roving after render (open toggle / hotkeys toggle adds/removes items).
  useEffect(() => {
    const root = toolbarRef.current;
    if (!root) return;
    const cur = root.querySelector<HTMLElement>(`#${CSS.escape(activeIdRef.current)}`);
    applyRoving(cur ? activeIdRef.current : `${ribbonId}-toggle`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showHotkeys]);

  return (
    <div className="busy-menubar hidden md:block print:hidden">
      <div
        ref={toolbarRef}
        className="flex items-center gap-1 overflow-x-auto px-4 py-0.5 leading-none"
        role="toolbar"
        aria-label={t("ribbon.quickEntry")}
        aria-orientation="horizontal"
        aria-activedescendant={`${ribbonId}-toggle`}
        onFocusCapture={(e) => {
          const el = e.target as HTMLElement;
          if (el.dataset.focusItem === "true" && el.id) applyRoving(el.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            const topBtn = document.querySelector<HTMLButtonElement>('.busy-topbar button.busy-menu');
            if (topBtn) {
              e.preventDefault();
              topBtn.focus();
            }
            return;
          }
          if (e.key === "ArrowDown") {
            const main = document.querySelector<HTMLElement>("main");
            const focusable = main?.querySelector<HTMLElement>(
              'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            );
            if (focusable) {
              e.preventDefault();
              focusable.focus();
            }
            return;
          }
          scope.onKeyDown(e);
        }}
      >

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          id={`${ribbonId}-toggle`}
          data-focus-item="true"
          className="mr-2 flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--amber-ink)]/80 hover:bg-[color:var(--amber-dark)]/20 hover:text-[color:var(--amber-ink)]"
          title={open ? "Collapse Quick Entry" : "Expand Quick Entry"}
          aria-expanded={open}
          aria-label={open ? "Collapse quick entry ribbon" : "Expand quick entry ribbon"}
          tabIndex={0}
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          <span>{t("ribbon.quickEntry")}</span>
          {open ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
        </button>

        {open && ACTIONS.map((a) => {
          const active = location.pathname === a.to;
          const translated = t(a.i18nKey);
          const label = translated === a.i18nKey ? a.label : translated;
          const itemId = `${ribbonId}-item-${a.to}`;
          return (
            <Link
              key={a.to}
              to={a.to}
              id={itemId}
              data-focus-item="true"
              data-active={active}
              className="busy-menu-item"
              role="button"
              aria-label={`${label} (${a.hotkey})`}
              aria-current={active ? "page" : undefined}
              tabIndex={-1}
              style={{ ["--dot" as string]: a.dot }}
              title={`${label} (${a.hotkey})`}
            >
              <span className="busy-menu-dot" aria-hidden="true" />
              <a.icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{label}</span>
              {showHotkeys && (
                <kbd className="ml-1 rounded border border-[color:var(--amber-ink)]/25 bg-[color:var(--amber-ink)]/10 px-1 text-[9px] font-mono text-[color:var(--amber-ink)]/80">
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
            id={`${ribbonId}-hotkeys`}
            data-focus-item="true"
            className="ml-auto rounded px-2 py-1 text-[10px] text-[color:var(--amber-ink)]/70 hover:bg-[color:var(--amber-dark)]/20 hover:text-[color:var(--amber-ink)]"
            title="Toggle keyboard shortcut hints"
            aria-pressed={showHotkeys}
            tabIndex={-1}
          >
            {showHotkeys ? "Hide keys" : "Show keys"}
          </button>
        )}
      </div>
    </div>
  );
}

