import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import {
  LayoutDashboard,
  Users,
  Package,
  ReceiptText,
  FileBarChart,
  Settings,
  Building2,
  Landmark,
  Repeat,
  FileCode2,
  ChevronDown,
  ShieldCheck,
  ShieldAlert,
  ArrowLeftRight,
  Printer,
  Wrench,
  BookOpen,
  Calculator,
  ScrollText,
  FileSpreadsheet,
  Receipt,
  Banknote,
  TrendingUp,
  TrendingDown,
  Layers,
  ClipboardList,
  Boxes,
  CalendarClock,
  Sparkles,
  Briefcase,
  Lock,
  HardDriveDownload,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { useCompany } from "@/lib/company-context";
import { useI18n, LANGUAGES, type LangCode } from "@/lib/i18n";
import { useCurrency, CURRENCIES } from "@/lib/currency";
import { useDateFormat, DATE_FORMATS, type DateFormatCode } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { Button } from "@/components/ui/button";

import { BackupNowButton } from "@/components/BackupNowButton";
import { RestoreNowButton } from "@/components/RestoreNowButton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOptionalKeyboard, useShortcut } from "@/lib/keyboard";
import { getMeta } from "@/lib/offline/db";


interface NavItem { title: string; url: string; icon: LucideIcon; i18nKey?: string }
interface NavGroup { label: string; items: NavItem[] }
interface TopMenu {
  key: string;
  label: string;
  /** Single letter used as Alt+key access key. Must be lowercase and unique. */
  accessKey: string;
  icon: LucideIcon;
  groups: NavGroup[];
  requiresGst?: boolean;
}

/** Render a menu label with the access-key letter underlined. */
function labelWithAccessKey(label: string, key: string) {
  const idx = label.toLowerCase().indexOf(key.toLowerCase());
  if (idx < 0) return <span>{label}</span>;
  return (
    <span>
      {label.slice(0, idx)}
      <u className="underline decoration-1 underline-offset-2">{label[idx]}</u>
      {label.slice(idx + 1)}
    </span>
  );
}

// Reorganised into Busy-style top menus: File / Masters / Transactions / Reports / Utilities / Print / Administration
const FILE_GROUPS: NavGroup[] = [
  {
    label: "Company",
    items: [
      { title: "Dashboard", url: "/app", icon: LayoutDashboard, i18nKey: "nav.dashboard" },
      { title: "Companies", url: "/app/companies", icon: Building2, i18nKey: "nav.companies" },
      { title: "Settings", url: "/app/settings", icon: Settings, i18nKey: "nav.companySettings" },
    ],
  },
];

const MENUS: TopMenu[] = [
  {
    key: "masters",
    accessKey: "m",
    label: "Masters",
    icon: Layers,
    groups: [
      {
        label: "Account & Inventory",
        items: [
          { title: "Ledgers / Parties", url: "/app/ledgers", icon: Users, i18nKey: "nav.ledgers" },
          { title: "BS Group Editor", url: "/app/account-groups", icon: Layers },
          { title: "Items / Stock", url: "/app/items", icon: Package, i18nKey: "nav.items" },
          { title: "Recurring Invoices", url: "/app/recurring", icon: Repeat, i18nKey: "nav.recurring" },
        ],
      },
    ],
  },
  {
    key: "transactions",
    accessKey: "t",
    label: "Transactions",
    icon: ArrowLeftRight,
    groups: [
      {
        label: "Vouchers",
        items: [
          { title: "All Vouchers", url: "/app/vouchers", icon: ReceiptText, i18nKey: "nav.allVouchers" },
          { title: "New Sales", url: "/app/vouchers/new/sales", icon: TrendingUp, i18nKey: "nav.newSales" },
          { title: "New Purchase", url: "/app/vouchers/new/purchase", icon: TrendingDown, i18nKey: "nav.newPurchase" },
          { title: "Credit Note", url: "/app/vouchers/new/credit_note", icon: ReceiptText },
          { title: "Debit Note", url: "/app/vouchers/new/debit_note", icon: ReceiptText },
          { title: "Receipt", url: "/app/vouchers/new/receipt", icon: ArrowLeftRight, i18nKey: "nav.receipt" },
          { title: "Payment", url: "/app/vouchers/new/payment", icon: Banknote, i18nKey: "nav.payment" },
          { title: "Journal", url: "/app/vouchers/new/journal", icon: BookOpen, i18nKey: "nav.journal" },
          { title: "Mfg & Process JV", url: "/app/vouchers/new/manufacturing", icon: Boxes },
        ],
      },
    ],
  },
  {
    key: "reports",
    accessKey: "e",

    label: "Reports",
    icon: FileBarChart,
    groups: [
      {
        label: "Core Financial",
        items: [
          { title: "Day Book", url: "/app/reports/day-book", icon: CalendarClock, i18nKey: "nav.dayBook" },
          { title: "Ledger Statement", url: "/app/reports/ledger", icon: ScrollText, i18nKey: "nav.ledgerStatement" },
          { title: "Group Ledger", url: "/app/reports/group-ledger", icon: Layers, i18nKey: "nav.groupLedger" },
          { title: "Trial Balance", url: "/app/reports/trial-balance", icon: Calculator, i18nKey: "nav.trialBalance" },
          { title: "Trading Account", url: "/app/reports/trading", icon: TrendingUp, i18nKey: "nav.tradingAccount" },
          { title: "Profit & Loss", url: "/app/reports/profit-loss", icon: TrendingUp, i18nKey: "nav.profitLoss" },
          { title: "Balance Sheet", url: "/app/reports/balance-sheet", icon: FileSpreadsheet, i18nKey: "nav.balanceSheet" },
          { title: "Outstanding", url: "/app/reports/outstanding", icon: ClipboardList },
          { title: "Cost Centre", url: "/app/reports/cost-centre", icon: Layers },
        ],
      },
      {
        label: "GST Reports",
        items: [
          { title: "GSTR-1 / 3B / 2B", url: "/app/reports/gstr1", icon: Receipt, i18nKey: "nav.gstReturns" },
          { title: "GST Sales Book", url: "/app/reports/gst-sales-book", icon: Receipt, i18nKey: "nav.gstSalesBook" },
          { title: "GST Purchase Book", url: "/app/reports/gst-purchase-book", icon: Receipt, i18nKey: "nav.gstPurchaseBook" },
          { title: "HSN Summary", url: "/app/reports/hsn-summary", icon: Boxes },
          { title: "ITC — Item wise", url: "/app/reports/itc-item-wise", icon: Receipt },
          { title: "ITC — Party wise", url: "/app/reports/itc-party-wise", icon: Receipt },
        ],
      },
      {
        label: "Inventory",
        items: [
          { title: "Stock Summary", url: "/app/reports/stock-summary", icon: Boxes, i18nKey: "nav.stockSummary" },
        ],
      },
    ],
  },
  {
    key: "utilities",
    accessKey: "u",
    label: "Utilities",
    icon: Wrench,
    groups: [
      {
        label: "Housekeeping",
        items: [
          { title: "Accounting Tools", url: "/app/housekeeping", icon: Wrench, i18nKey: "nav.accountingTools" },
          { title: "Data Health", url: "/app/data-health", icon: ShieldCheck },
          { title: "Bank Reconciliation", url: "/app/bank", icon: Landmark, i18nKey: "nav.bankRecon" },
          { title: "BRS (Book vs Bank)", url: "/app/reports/brs", icon: Landmark, i18nKey: "nav.brs" },
          { title: "GSTR-1 Excel → JSON", url: "/app/tools/gstr1-json", icon: FileCode2 },
          { title: "AI Assistant", url: "/app/assistant", icon: Sparkles, i18nKey: "nav.aiAssistant" },
        ],
      },
    ],
  },
  {
    key: "print",
    accessKey: "n",

    label: "Print",
    icon: Printer,
    groups: [
      {
        label: "Print & Export",
        items: [
          { title: "Reports Hub", url: "/app/reports", icon: FileBarChart, i18nKey: "nav.reportsHub" },
        ],
      },
    ],
  },
  {
    key: "administration",
    accessKey: "a",
    label: "Administration",
    icon: ShieldCheck,
    groups: [
      {
        label: "System",
        items: [
          { title: "E-Invoice / EWB", url: "/app/einvoice", icon: FileCode2, i18nKey: "nav.einvoice" },
          { title: "License", url: "/app/settings/license", icon: ShieldCheck },
          { title: "Tax Audit", url: "/app/reports/tax-audit", icon: ShieldCheck },
        ],
      },
    ],
  },
];

const GST_URLS = new Set([
  "/app/reports/gstr1",
  "/app/einvoice",
  "/app/reports/gst-sales-book",
  "/app/reports/gst-purchase-book",
  "/app/reports/tax-audit",
  "/app/reports/itc-item-wise",
  "/app/reports/itc-party-wise",
]);
const INVENTORY_URLS = new Set([
  "/app/items",
  "/app/reports/stock-summary",
  "/app/reports/hsn-summary",
  "/app/vouchers/new/manufacturing",
  "/app/reports/trading",
]);

export function TopMenuBar({ rightExtras, onLock, onBackupNow, backupBusy, backupLabel, quickPanel }: { rightExtras?: ReactNode; onLock?: () => void; onBackupNow?: () => void; backupBusy?: boolean; backupLabel?: string; quickPanel?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeMembership } = useCompany();
  const { t, lang, setLang } = useI18n();
  const { code: currencyCode, setCode: setCurrencyCode } = useCurrency();
  const { code: dateCode, setCode: setDateCode } = useDateFormat();
  const [deadLetterCount, setDeadLetterCount] = useState(0);
  const [consistencyDrift, setConsistencyDrift] = useState(false);

  useEffect(() => {
    const update = async () => {
      try {
        const { deadLetterCount: getCount } = await import("@/lib/offline/outbox");
        const count = await getCount();
        setDeadLetterCount(count);
      } catch { /* ignore */ }
    };
    const checkConsistency = async () => {
      if (!activeMembership?.company_id) return;
      try {
        const report = await getMeta<any>(`consistency_report:${activeMembership.company_id}`);
        setConsistencyDrift(report && !report.is_healthy);
      } catch { /* ignore */ }
    };

    update();
    checkConsistency();
    window.addEventListener("ym:outbox-changed", update);
    window.addEventListener("ym:local-data-restored", update);
    window.addEventListener("ym:consistency-alert", checkConsistency as any);
    return () => {
      window.removeEventListener("ym:outbox-changed", update);
      window.removeEventListener("ym:local-data-restored", update);
      window.removeEventListener("ym:consistency-alert", checkConsistency as any);
    };
  }, [activeMembership?.company_id]);


  const gstEnabled = Boolean(activeMembership?.companies?.gst_registered) || Boolean(activeMembership?.companies?.gstin);
  const inventoryEnabled = activeMembership?.companies?.inventory_enabled ?? true;

  const tt = (item: { title: string; i18nKey?: string }) => (item.i18nKey ? t(item.i18nKey) : item.title);

  const visible = useMemo(
    () =>
      MENUS.map((m) => ({
        ...m,
        groups: m.groups
          .map((g) => ({
            ...g,
            items: g.items.filter(
              (i) => (gstEnabled || !GST_URLS.has(i.url)) && (inventoryEnabled || !INVENTORY_URLS.has(i.url)),
            ),
          }))
          .filter((g) => g.items.length > 0),
      })).filter((m) => m.groups.length > 0),
    [gstEnabled, inventoryEnabled],
  );

  const isMenuActive = (m: TopMenu) =>
    m.groups.some((g) =>
      g.items.some((i) =>
        i.url === "/app" ? location.pathname === "/app" : location.pathname.startsWith(i.url),
      ),
    );

  // ---------------------------------------------------------------------------
  // Keyboard behaviour — SINGLE OWNER.
  //
  // Radix Menubar owns: Tab exit, Arrow focus movement between triggers,
  // Enter/Space/ArrowDown to open a trigger, Arrow keys inside open menus,
  // and Escape to close an open dropdown (which restores trigger focus).
  //
  // We enhance ONLY two things:
  //   1. Hover any trigger  → its menu opens (onMouseEnter).
  //   2. Focus a trigger via ArrowLeft/ArrowRight  → its menu opens too
  //      (so the user never has to press Enter to see the dropdown).
  //
  // Everything is routed through `openMenuKey` (the controlled `value` of
  // <Menubar>). No custom keydown listeners, no capture-phase handlers,
  // no roving tabindex of ours.
  // ---------------------------------------------------------------------------
  const menubarRef = useRef<HTMLDivElement | null>(null);
  const menubarId = useId();
  const [openMenuKey, setOpenMenuKey] = useState("");
  // Timestamp of the last dropdown close. Escape that closes a dropdown must
  // NOT also trigger the exit confirmation (staged Escape ladder).
  const lastMenuCloseRef = useRef(0);
  const handleMenubarValueChange = useCallback((next: string) => {
    setOpenMenuKey((prev) => {
      if (prev && !next) lastMenuCloseRef.current = Date.now();
      return next;
    });
  }, []);

  const kb = useOptionalKeyboard();
  useShortcut("Escape", (e) => {
    const isDialogOpen = document.querySelector('[role="dialog"], [data-state="open"][role="alertdialog"]');
    if (isDialogOpen) return;

    const menuOpen = openMenuKey !== "";
    if (menuOpen) {
      setOpenMenuKey("");
      lastMenuCloseRef.current = Date.now();
      return;
    }

    if (Date.now() - lastMenuCloseRef.current < 200) return;
    
    // If not in menu, check if we need to exit screen or app
    if (location.pathname !== "/app") {
      navigate({ to: "/app" });
    } else {
      setConfirmOpen(true);
    }
  }, { enabled: true, allowInField: false, description: "Staged Exit" });

  const [confirmOpen, setConfirmOpen] = useState(false);



  const orderedMenuKeys = useMemo(
    () => ["file", ...visible.map((menu) => menu.key)],
    [visible],
  );

  // This handler is attached directly to each Radix trigger. Do not move it to
  // a native root listener: stopping propagation there prevents Radix's React
  // keyboard handler from receiving the event at all.
  const handleTriggerKeyDown = useCallback(
    (key: string) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Escape" && openMenuKey === key) {
        e.preventDefault();
        lastMenuCloseRef.current = Date.now();
        setOpenMenuKey("");
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const currentIndex = orderedMenuKeys.indexOf(key);
        const delta = e.key === "ArrowRight" ? 1 : -1;
        const nextIndex = (currentIndex + delta + orderedMenuKeys.length) % orderedMenuKeys.length;
        const nextKey = orderedMenuKeys[nextIndex];
        setOpenMenuKey(nextKey);
        window.requestAnimationFrame(() => {
          menubarRef.current
            ?.querySelector<HTMLButtonElement>(`button.busy-menu[data-menu-key="${nextKey}"]`)
            ?.focus();
        });
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

      // If this trigger's dropdown is NOT already open, ArrowDown jumps down
      // into the Quick Entry ribbon (Busy/Tally-style region hop). ArrowUp
      // is a no-op — there is nothing above the menubar.
      if (openMenuKey !== key) {
        if (e.key === "ArrowUp") return;
        e.preventDefault();
        const ribbonItem = document.querySelector<HTMLElement>(
          '[role="toolbar"] [data-focus-item="true"]',
        );
        if (ribbonItem) ribbonItem.focus();
        return;
      }

      // Menu already open (e.g. auto-opened by hover or ArrowLeft/Right):
      // drill focus into the dropdown items.
      e.preventDefault();
      const edge = e.key === "ArrowDown" ? "first" : "last";
      const focusDropdownEdge = () => {
        const content = document.querySelector<HTMLElement>(
          `[data-top-menu-content="${key}"][data-state="open"]`,
        );
        const items = content?.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([data-disabled])',
        );
        if (!items?.length) return false;
        (edge === "first" ? items[0] : items[items.length - 1]).focus();
        return true;
      };

      // React may need one frame to mount a newly opened portal. The second
      // frame is a deterministic fallback for slower desktop WebViews.
      if (!focusDropdownEdge()) {
        window.requestAnimationFrame(() => {
          if (!focusDropdownEdge()) window.requestAnimationFrame(focusDropdownEdge);
        });
      }

    },
    [openMenuKey, orderedMenuKeys],
  );

  const openOnHover = useCallback((key: string) => () => setOpenMenuKey(key), []);

  // ---------------------------------------------------------------------------
  // Edge navigation: ArrowUp on the first dropdown item hops focus to the
  // Quick Entry ribbon; ArrowDown on the last item hops focus to <main>.
  // We blur the currently focused menu item before closing so Radix has
  // nowhere to return focus to, then we focus the target region.
  // ---------------------------------------------------------------------------
  const handleContentEdgeNav = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const item = (e.target as HTMLElement).closest<HTMLElement>(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
      );
      if (!item) return;

      const content = e.currentTarget;
      const items = Array.from(
        content.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled]), [role="menuitemradio"]:not([disabled])'
        )
      ).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          el.getAttribute("aria-disabled") !== "true"
      );

      const idx = items.indexOf(item);
      if (idx === -1) return;

      const isFirstEdge = e.key === "ArrowUp" && idx === 0;
      const isLastEdge = e.key === "ArrowDown" && idx === items.length - 1;
      if (!isFirstEdge && !isLastEdge) return;

      e.preventDefault();
      e.stopPropagation();

      // Blur BEFORE closing so Radix cannot restore focus to the trigger.
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") active.blur();

      setOpenMenuKey("");
      lastMenuCloseRef.current = Date.now();

      requestAnimationFrame(() => {
        if (isFirstEdge) {
          const ribbonItem = document.querySelector<HTMLElement>(
            '[role="toolbar"] [data-focus-item="true"]'
          );
          ribbonItem?.focus();
        } else {
          const main = document.querySelector<HTMLElement>("main");
          const focusable = main?.querySelector<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          );
          focusable?.focus();
        }
      });
    },
    []
  );

  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  // Alt+letter → focus & open the matching top-level menu.
  useEffect(() => {
    if (!kb) return;
    const accessKeys: Array<{ key: string; menuKey: string; label: string }> = [
      { key: "f", menuKey: "file", label: "Open File menu" },
      ...visible.map((m) => ({ key: m.accessKey, menuKey: m.key, label: `Open ${m.label} menu` })),
    ];
    const unsubs = accessKeys.map(({ key, menuKey, label }) =>
      kb.register({
        id: `topmenubar-alt-${key}`,
        combo: `Alt+${key}`,
        scope: "global",
        description: label,
        handler: (e) => {
          const root = menubarRef.current;
          if (!root) return;
          const btn = root.querySelector<HTMLButtonElement>(
            `button.busy-menu[data-access-key="${key}"]`,
          );
          if (!btn) return;
          e.preventDefault();
          btn.focus();
          setOpenMenuKey(menuKey);
        },
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [kb, visible]);

  // Escape on a focused menubar trigger (no dropdown open) → confirm exit.
  // Radix owns the "close open dropdown" Escape; only after the dropdown is
  // gone does focus land back on the trigger, and the NEXT Escape reaches us.
  useShortcut(
    "Escape",
    (e) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !active.classList.contains("busy-menu")) return;
      if (active.getAttribute("aria-expanded") === "true") return;
      if (document.querySelector("[data-radix-popper-content-wrapper]")) return;
      // Same keystroke that just closed a dropdown must not exit the app.
      if (Date.now() - lastMenuCloseRef.current < 500) return;
      if (openMenuKey) return;
      if (!onLock) return;
      e.preventDefault();
      setExitConfirmOpen(true);
    },

    { scope: "global", allowInField: true, description: "Exit application" },
  );

  // Any part of the app can request the exit dialog by dispatching
  // `app:exit-request`. Used by the app-level Escape ladder so pages
  // without a focused menubar (Companies, dashboard, empty routes) can
  // exit in a single keypress instead of hopping through the menubar.
  useEffect(() => {
    const onExit = () => {
      if (!onLock) return;
      // A dropdown that just closed consumed this Escape — don't exit.
      if (Date.now() - lastMenuCloseRef.current < 500) return;

      // Close any open menubar dropdown and blur the trigger so Enter can't
      // fall through to a menubar button while the confirmation is open.
      setOpenMenuKey("");
      const active = document.activeElement as HTMLElement | null;
      if (active && typeof active.blur === "function") active.blur();
      setExitConfirmOpen(true);
    };
    window.addEventListener("app:exit-request", onExit);
    return () => window.removeEventListener("app:exit-request", onExit);
  }, [onLock]);


  return (
    <Menubar
      ref={menubarRef}
      value={openMenuKey}
      onValueChange={handleMenubarValueChange}
      className="busy-topbar print:hidden h-auto space-x-0 rounded-none border-x-0 border-t-0 p-0 shadow-none"
      aria-label="Application menu"
    >
      {/* Brand block — acts as the File menu */}
      <MenubarMenu value="file">
        <MenubarTrigger asChild>
          <button
            type="button"
            className="busy-brand busy-menu"
            title="File (Alt+F)"
            data-access-key="f"
            data-menu-key="file"
            id={`${menubarId}-menu-file`}
            onMouseEnter={openOnHover("file")}
             onKeyDown={handleTriggerKeyDown("file")}
          >

            <span className="busy-brand-mark">म</span>
            <span className="busy-brand-name">Mehtaji</span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </MenubarTrigger>
        <MenubarContent
          data-top-menu-content="file"
          align="start"
          className="busy-menu-dropdown min-w-[240px]"
          onKeyDown={handleContentEdgeNav}
        >
          {FILE_GROUPS.map((g, gi) => (
            <div key={g.label}>
              {gi > 0 && <MenubarSeparator />}
              <MenubarLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {g.label}
              </MenubarLabel>
              {g.items.map((i) => (
                <MenubarItem key={i.url} onSelect={() => navigate({ to: i.url })} className="gap-2">
                  <i.icon className="h-4 w-4 text-muted-foreground" />
                  <span>{tt(i)}</span>
                </MenubarItem>
              ))}
            </div>
          ))}
          <MenubarSeparator />
          <MenubarItem onSelect={() => navigate({ to: "/privacy" })} className="gap-2">
            <span className="w-4" />
            <span>Privacy Policy</span>
          </MenubarItem>
        </MenubarContent>

      </MenubarMenu>

      {/* Menu items */}
      <nav
        className="busy-menus"
        aria-label="Primary menus"
      >

        {visible.map((m) => {
          const active = isMenuActive(m);
          const isAdmin = m.key === "administration";
          return (
            <MenubarMenu key={m.key} value={m.key}>
              <MenubarTrigger asChild>
                <button
                  type="button"
                  className={cn("busy-menu", active && "busy-menu-active")}
                  data-access-key={m.accessKey}
                  data-menu-key={m.key}
                  id={`${menubarId}-menu-${m.key}`}
                  title={`${m.label} (Alt+${m.accessKey.toUpperCase()})`}
                  onMouseEnter={openOnHover(m.key)}
                   onKeyDown={handleTriggerKeyDown(m.key)}
                >
                  {labelWithAccessKey(m.label, m.accessKey)}
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </MenubarTrigger>
              <MenubarContent
                data-top-menu-content={m.key}
                align="start"
                className="busy-menu-dropdown min-w-[240px]"
                onKeyDown={handleContentEdgeNav}
              >
                {m.groups.map((g, gi) => (
                  <div key={g.label}>
                    {gi > 0 && <MenubarSeparator />}
                    <MenubarLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </MenubarLabel>
                    {g.items.map((i) => (
                      <MenubarItem
                        key={i.url}
                        onSelect={() => navigate({ to: i.url })}
                        className="gap-2"
                      >
                        <i.icon className="h-4 w-4 text-muted-foreground" />
                        <span>{tt(i)}</span>
                      </MenubarItem>
                    ))}
                  </div>
                ))}
                {isAdmin && (
                  <>
                    <MenubarSeparator />
                    <MenubarLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Session
                    </MenubarLabel>
                    {onBackupNow && (
                      <MenubarItem
                        onSelect={(e) => { e.preventDefault(); onBackupNow(); }}
                        className="gap-2"
                        disabled={backupBusy}
                      >
                        <HardDriveDownload className="h-4 w-4 text-muted-foreground" />
                        <span>{backupBusy ? "Saving backup…" : (backupLabel || "Backup now")}</span>
                      </MenubarItem>
                    )}
                    <MenubarItem
                      onSelect={() => onLock?.()}
                      className="gap-2"
                      disabled={!onLock}
                    >
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <span>Exit</span>
                    </MenubarItem>
                    <MenubarSeparator />
                    <MenubarLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Preferences
                    </MenubarLabel>
                    <MenubarSub>
                      <MenubarSubTrigger className="gap-2">
                        <span>Language</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {LANGUAGES.find((l) => l.code === lang)?.native ?? lang}
                        </span>
                      </MenubarSubTrigger>
                      <MenubarSubContent className="busy-menu-dropdown max-h-[320px] overflow-y-auto">
                        <MenubarRadioGroup value={lang} onValueChange={(v) => setLang(v as LangCode)}>
                          {LANGUAGES.map((l) => (
                            <MenubarRadioItem key={l.code} value={l.code}>
                              <span className="flex items-center gap-2">
                                <span>{l.native}</span>
                                <span className="text-xs text-muted-foreground">({l.label})</span>
                              </span>
                            </MenubarRadioItem>
                          ))}
                        </MenubarRadioGroup>
                      </MenubarSubContent>
                    </MenubarSub>
                    <MenubarSub>
                      <MenubarSubTrigger className="gap-2">
                        <span>Currency</span>
                        <span className="ml-auto text-xs text-muted-foreground">{currencyCode}</span>
                      </MenubarSubTrigger>
                      <MenubarSubContent className="busy-menu-dropdown max-h-[320px] overflow-y-auto">
                        <MenubarRadioGroup value={currencyCode} onValueChange={setCurrencyCode}>
                          {CURRENCIES.map((c) => (
                            <MenubarRadioItem key={c.code} value={c.code}>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{c.symbol}</span>
                                <span>{c.code}</span>
                                <span className="hidden text-xs text-muted-foreground sm:inline">— {c.name}</span>
                              </span>
                            </MenubarRadioItem>
                          ))}
                        </MenubarRadioGroup>
                      </MenubarSubContent>
                    </MenubarSub>
                    <MenubarSub>
                      <MenubarSubTrigger className="gap-2">
                        <span>Date format</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {DATE_FORMATS.find((f) => f.code === dateCode)?.sample ?? dateCode}
                        </span>
                      </MenubarSubTrigger>
                      <MenubarSubContent className="busy-menu-dropdown max-h-[320px] overflow-y-auto">
                        <MenubarRadioGroup value={dateCode} onValueChange={(v) => setDateCode(v as DateFormatCode)}>
                          {DATE_FORMATS.map((f) => (
                            <MenubarRadioItem key={f.code} value={f.code}>
                              <span className="flex items-center gap-2">
                                <span>{f.label}</span>
                                <span className="text-xs text-muted-foreground">— {f.sample}</span>
                              </span>
                            </MenubarRadioItem>
                          ))}
                        </MenubarRadioGroup>
                      </MenubarSubContent>
                    </MenubarSub>
                  </>
                )}
              </MenubarContent>
            </MenubarMenu>
          );
        })}
      </nav>


      {/* Right-side extras + Company switcher */}
      <div className="busy-company gap-2">
        {deadLetterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => navigate({ to: "/app/data-health" })}
            title={`${deadLetterCount} sync failures require attention`}
          >
            <AlertTriangle className="h-4 w-4" />
            <span className="text-xs font-bold">{deadLetterCount}</span>
          </Button>
        )}
        {rightExtras}
        {consistencyDrift && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-warning hover:bg-warning/10 hover:text-warning"
            onClick={() => navigate({ to: "/app/data-health" })}
            title="Accounting consistency issues detected. Check Data Health."
          >
            <ShieldAlert className="h-4 w-4" />
            <span className="text-xs font-bold">Audit</span>
          </Button>
        )}
        <CompanySwitcher />
        <BackupNowButton />
        <RestoreNowButton />
      </div>


      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            // Focus the Cancel ("Stay") button explicitly so keyboard users
            // land on the safe default and Enter can't fall through to any
            // still-focused menubar trigger behind the dialog.
            requestAnimationFrame(() => {
              const stay = document.querySelector<HTMLButtonElement>(
                '[data-exit-confirm="stay"]',
              );
              stay?.focus();
            });
          }}
          onCloseAutoFocus={(e) => {
            // Don't let Radix restore focus to a menubar trigger — that's how
            // the follow-up Enter kept opening the Masters dropdown.
            e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Enter inside the dialog must act on the focused dialog button
              // only. Stop it before any global/menubar handler sees it.
              e.stopPropagation();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Exit application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock the session and return you to the start screen. Any unsaved work in open forms may be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-exit-confirm="stay" autoFocus>Stay</AlertDialogCancel>
            <AlertDialogAction
              data-exit-confirm="exit"
              onClick={() => {
                setExitConfirmOpen(false);
                onLock?.();
              }}
            >
              Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Menubar>
  );
}
