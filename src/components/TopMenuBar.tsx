import { useLocation, useNavigate } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
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
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/lib/company-context";
import { useI18n, LANGUAGES, type LangCode } from "@/lib/i18n";
import { useCurrency, CURRENCIES } from "@/lib/currency";
import { useDateFormat, DATE_FORMATS, type DateFormatCode } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { CompanySwitcher } from "@/components/CompanySwitcher";

interface NavItem { title: string; url: string; icon: LucideIcon; i18nKey?: string }
interface NavGroup { label: string; items: NavItem[] }
interface TopMenu {
  key: string;
  label: string;
  icon: LucideIcon;
  groups: NavGroup[];
  requiresGst?: boolean;
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

export function TopMenuBar({ rightExtras }: { rightExtras?: ReactNode }) {
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

  return (
    <div className="busy-topbar print:hidden">
      {/* Brand block — acts as the File menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="busy-brand busy-menu" title="File">
            <span className="busy-brand-mark">म</span>
            <span className="busy-brand-name">
              <span>Your</span>
              <span>Mehtaji</span>
            </span>
            <ChevronDown className="h-3 w-3 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="busy-menu-dropdown min-w-[240px]">
          {FILE_GROUPS.map((g, gi) => (
            <div key={g.label}>
              {gi > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {g.label}
              </DropdownMenuLabel>
              {g.items.map((i) => (
                <DropdownMenuItem key={i.url} onSelect={() => navigate({ to: i.url })} className="gap-2">
                  <i.icon className="h-4 w-4 text-muted-foreground" />
                  <span>{tt(i)}</span>
                </DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Menu items */}
      <nav
        className="busy-menus"
        onKeyDown={(e) => {
          const key = e.key;
          if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") return;
          const root = e.currentTarget;
          const triggers = Array.from(root.querySelectorAll<HTMLButtonElement>('button.busy-menu'));
          if (triggers.length === 0) return;
          const active = document.activeElement as HTMLElement | null;
          let idx = active ? triggers.indexOf(active as HTMLButtonElement) : -1;
          if (idx === -1) return;
          e.preventDefault();
          let nextIdx = idx;
          if (key === "ArrowRight") nextIdx = (idx + 1) % triggers.length;
          else if (key === "ArrowLeft") nextIdx = (idx - 1 + triggers.length) % triggers.length;
          else if (key === "Home") nextIdx = 0;
          else if (key === "End") nextIdx = triggers.length - 1;
          const wasOpen = active?.getAttribute("aria-expanded") === "true";
          const nextBtn = triggers[nextIdx];
          nextBtn.focus();
          if (wasOpen) {
            // Close current then open next to mimic native menubar behavior
            active?.click();
            setTimeout(() => nextBtn.click(), 0);
          }
        }}
      >
        {visible.map((m) => {
          const active = isMenuActive(m);
          const isAdmin = m.key === "administration";
          return (
            <DropdownMenu key={m.key}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn("busy-menu", active && "busy-menu-active")}
                >
                  {m.label}
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="busy-menu-dropdown min-w-[240px]">
                {m.groups.map((g, gi) => (
                  <div key={g.label}>
                    {gi > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {g.label}
                    </DropdownMenuLabel>
                    {g.items.map((i) => (
                      <DropdownMenuItem
                        key={i.url}
                        onSelect={() => navigate({ to: i.url })}
                        className="gap-2"
                      >
                        <i.icon className="h-4 w-4 text-muted-foreground" />
                        <span>{tt(i)}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Preferences
                    </DropdownMenuLabel>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2">
                        <span>Language</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {LANGUAGES.find((l) => l.code === lang)?.native ?? lang}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="busy-menu-dropdown max-h-[320px] overflow-y-auto">
                        <DropdownMenuRadioGroup value={lang} onValueChange={(v) => setLang(v as LangCode)}>
                          {LANGUAGES.map((l) => (
                            <DropdownMenuRadioItem key={l.code} value={l.code}>
                              <span className="flex items-center gap-2">
                                <span>{l.native}</span>
                                <span className="text-xs text-muted-foreground">({l.label})</span>
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2">
                        <span>Currency</span>
                        <span className="ml-auto text-xs text-muted-foreground">{currencyCode}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="busy-menu-dropdown max-h-[320px] overflow-y-auto">
                        <DropdownMenuRadioGroup value={currencyCode} onValueChange={setCurrencyCode}>
                          {CURRENCIES.map((c) => (
                            <DropdownMenuRadioItem key={c.code} value={c.code}>
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground">{c.symbol}</span>
                                <span>{c.code}</span>
                                <span className="hidden text-xs text-muted-foreground sm:inline">— {c.name}</span>
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2">
                        <span>Date format</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {DATE_FORMATS.find((f) => f.code === dateCode)?.sample ?? dateCode}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="busy-menu-dropdown max-h-[320px] overflow-y-auto">
                        <DropdownMenuRadioGroup value={dateCode} onValueChange={(v) => setDateCode(v as DateFormatCode)}>
                          {DATE_FORMATS.map((f) => (
                            <DropdownMenuRadioItem key={f.code} value={f.code}>
                              <span className="flex items-center gap-2">
                                <span>{f.label}</span>
                                <span className="text-xs text-muted-foreground">— {f.sample}</span>
                              </span>
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </nav>

      {/* Right-side extras (e.g. Backup now) + Company switcher */}
      <div className="busy-company gap-2">
        {rightExtras}
        <CompanySwitcher />
      </div>

    </div>
  );
}

