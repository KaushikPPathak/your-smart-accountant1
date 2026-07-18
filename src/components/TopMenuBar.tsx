import { useLocation, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

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
import { useOptionalKeyboard } from "@/lib/keyboard";


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
      { title: "Company Settings", url: "/app/settings", icon: Settings, i18nKey: "nav.companySettings" },
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
    accessKey: "r",
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
    accessKey: "p",
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

  // Alt+letter — focus & open the matching top-level menu (File=F plus each menu's accessKey).
  const menubarRef = useRef<HTMLDivElement | null>(null);
  const menubarId = useId();
  const [openMenuKey, setOpenMenuKey] = useState("");

  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const handleMenuTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const triggers = Array.from(
      menubarRef.current?.querySelectorAll<HTMLButtonElement>("button.busy-menu") ?? [],
    );
    const currentIndex = triggers.indexOf(event.currentTarget);
    if (currentIndex < 0 || triggers.length === 0) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = triggers.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % triggers.length;
    else nextIndex = (currentIndex - 1 + triggers.length) % triggers.length;

    event.preventDefault();
    event.stopPropagation();
    const next = triggers[nextIndex];
    next.focus({ preventScroll: true });
    if (openMenuKey) setOpenMenuKey(next.dataset.menuKey ?? "");
  };

  // Alt+letter → focus & open the matching top-level menu. Registered through
  // the centralized keyboard engine so it appears in the cheat sheet and
  // respects the global typing-target guard (allowInField defaults to false).
  const kb = useOptionalKeyboard();
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
  }, [kb, visible, setOpenMenuKey]);

  // Radix owns vertical trigger keys so opening and item autofocus happen in
  // the same event. Horizontal movement is explicit because the triggers are
  // split by the visual navigation wrapper.

  // Escape on a focused top-menu trigger (no menu open) → exit the app.
  // When a dropdown IS open, Radix handles Escape (closes menu, returns focus to trigger).
  // A second Escape then reaches this handler and triggers exit.
  useEffect(() => {
    const root = menubarRef.current;
    if (!root) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || !target.classList.contains("busy-menu")) return;
      // If any dropdown is still open, let Radix close it first.
      if (target.getAttribute("aria-expanded") === "true") return;
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      if (!onLock) return;
      e.preventDefault();
      e.stopPropagation();
      setExitConfirmOpen(true);
    };
    root.addEventListener("keydown", onEsc);
    return () => root.removeEventListener("keydown", onEsc);
  }, [onLock]);

  return (
    <Menubar
      ref={menubarRef}
      value={openMenuKey}
      onValueChange={setOpenMenuKey}
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
            onKeyDown={(event) => handleMenuTriggerKeyDown(event)}
          >
            <span className="busy-brand-mark">म</span>
            <span className="busy-brand-name">
              <span>Your</span>
              <span>Mehtaji</span>
            </span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </MenubarTrigger>
        <MenubarContent align="start" className="busy-menu-dropdown min-w-[240px]">
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
                  onKeyDown={(event) => handleMenuTriggerKeyDown(event)}
                >
                  {labelWithAccessKey(m.label, m.accessKey)}
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </MenubarTrigger>
              <MenubarContent align="start" className="busy-menu-dropdown min-w-[240px]">
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
        {rightExtras}
        <CompanySwitcher />
      </div>

      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit application?</AlertDialogTitle>
            <AlertDialogDescription>
              This will lock the session and return you to the start screen. Any unsaved work in open forms may be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Stay</AlertDialogCancel>
            <AlertDialogAction
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

