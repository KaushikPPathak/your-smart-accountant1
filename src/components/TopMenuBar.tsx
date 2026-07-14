import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/lib/company-context";
import { useI18n } from "@/lib/i18n";
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
const MENUS: TopMenu[] = [
  {
    key: "file",
    label: "File",
    icon: Briefcase,
    groups: [
      {
        label: "Company",
        items: [
          { title: "Dashboard", url: "/app", icon: LayoutDashboard, i18nKey: "nav.dashboard" },
          { title: "Companies", url: "/app/companies", icon: Building2, i18nKey: "nav.companies" },
          { title: "Company Settings", url: "/app/settings", icon: Settings, i18nKey: "nav.companySettings" },
        ],
      },
    ],
  },
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

export function TopMenuBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeMembership } = useCompany();
  const { t } = useI18n();

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

  const companyName = activeMembership?.companies?.name ?? "Select Company";

  return (
    <div className="busy-topbar print:hidden">
      {/* Brand block */}
      <Link to="/app" className="busy-brand" title="Dashboard">
        <span className="busy-brand-mark">म</span>
        <span className="busy-brand-name">
          <span>Your</span>
          <span>Mehtaji</span>
        </span>
      </Link>

      {/* Menu items */}
      <nav className="busy-menus">
        {visible.map((m) => {
          const active = isMenuActive(m);
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
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </nav>

      {/* Company switcher at right (moved from second-line header) */}
      <div className="busy-company">
        <CompanySwitcher />
      </div>

    </div>
  );
}
