import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  Briefcase,
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
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCompany } from "@/lib/company-context";
import { CompanyFlyout } from "@/components/CompanyFlyout";
import { useI18n } from "@/lib/i18n";

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  i18nKey?: string;
}
interface NavSubGroup {
  label: string;
  i18nKey?: string;
  items: NavItem[];
}
interface NavSection {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  subGroups?: NavSubGroup[];
  requiresGst?: boolean;
  i18nKey?: string;
}

// Busy-style top-level menu structure
const SECTIONS: NavSection[] = [
  {
    label: "Company",
    i18nKey: "nav.section.company",
    icon: Briefcase,
    items: [
      { title: "Dashboard", url: "/app", icon: LayoutDashboard, i18nKey: "nav.dashboard" },
      { title: "Companies", url: "/app/companies", icon: Building2, i18nKey: "nav.companies" },
      { title: "Company Settings", url: "/app/settings", icon: Settings, i18nKey: "nav.companySettings" },
    ],
  },
  {
    label: "Administration",
    i18nKey: "nav.section.administration",
    icon: ShieldCheck,
    items: [
      { title: "Ledgers / Parties", url: "/app/ledgers", icon: Users, i18nKey: "nav.ledgers" },
      { title: "Group Manager", url: "/app/account-groups", icon: Layers, i18nKey: "nav.groupManager" },
      { title: "Items / Stock", url: "/app/items", icon: Package, i18nKey: "nav.items" },
      { title: "Recurring Invoices", url: "/app/recurring", icon: Repeat, i18nKey: "nav.recurring" },
    ],
  },
  {
    label: "Transactions",
    i18nKey: "nav.section.transactions",
    icon: ArrowLeftRight,
    items: [
      { title: "All Vouchers", url: "/app/vouchers", icon: ReceiptText, i18nKey: "nav.allVouchers" },
      { title: "New Sales", url: "/app/vouchers/new/sales", icon: TrendingUp, i18nKey: "nav.newSales" },
      { title: "New Purchase", url: "/app/vouchers/new/purchase", icon: TrendingDown, i18nKey: "nav.newPurchase" },
      { title: "Credit Note", url: "/app/vouchers/new/credit_note", icon: ReceiptText, i18nKey: "nav.creditNote" },
      { title: "Debit Note", url: "/app/vouchers/new/debit_note", icon: ReceiptText, i18nKey: "nav.debitNote" },
      { title: "Receipt", url: "/app/vouchers/new/receipt", icon: ArrowLeftRight, i18nKey: "nav.receipt" },
      { title: "Payment", url: "/app/vouchers/new/payment", icon: Banknote, i18nKey: "nav.payment" },
      { title: "Journal", url: "/app/vouchers/new/journal", icon: BookOpen, i18nKey: "nav.journal" },
      { title: "Manufacturing Journal", url: "/app/vouchers/new/manufacturing", icon: Boxes, i18nKey: "nav.manufacturing" },
    ],
  },
  {
    label: "Display / Print",
    i18nKey: "nav.section.display",
    icon: Printer,
    items: [
      { title: "Reports Hub", url: "/app/reports", icon: FileBarChart, i18nKey: "nav.reportsHub" },
    ],
    subGroups: [
      {
        label: "Core Financials",
        i18nKey: "nav.subgroup.coreFinancials",
        items: [
          { title: "Day Book", url: "/app/reports/day-book", icon: CalendarClock, i18nKey: "nav.dayBook" },
          { title: "Ledger Statement", url: "/app/reports/ledger", icon: ScrollText, i18nKey: "nav.ledgerStatement" },
          { title: "Group Ledger (B/S & P&L)", url: "/app/reports/group-ledger", icon: Layers, i18nKey: "nav.groupLedger" },
          { title: "Trial Balance", url: "/app/reports/trial-balance", icon: Calculator, i18nKey: "nav.trialBalance" },
          { title: "Trading Account", url: "/app/reports/trading", icon: TrendingUp, i18nKey: "nav.tradingAccount" },
          { title: "Profit & Loss", url: "/app/reports/profit-loss", icon: TrendingUp, i18nKey: "nav.profitLoss" },
          { title: "Balance Sheet", url: "/app/reports/balance-sheet", icon: FileSpreadsheet, i18nKey: "nav.balanceSheet" },
        ],
      },
      {
        label: "GST & Tax Compliance",
        i18nKey: "nav.subgroup.gstTax",
        items: [
          { title: "Tax Audit (3CD)", url: "/app/reports/tax-audit", icon: ShieldCheck, i18nKey: "nav.taxAudit3CD" },
          { title: "GSTR-1 / 3B / 2B", url: "/app/reports/gstr1", icon: Receipt, i18nKey: "nav.gstReturns" },
          { title: "GST Sales Book", url: "/app/reports/gst-sales-book", icon: Receipt, i18nKey: "nav.gstSalesBook" },
          { title: "GST Purchase Book", url: "/app/reports/gst-purchase-book", icon: Receipt, i18nKey: "nav.gstPurchaseBook" },
          { title: "HSN Summary", url: "/app/reports/hsn-summary", icon: Boxes, i18nKey: "nav.hsnSummary" },
          { title: "ITC — Item-wise", url: "/app/reports/itc-item-wise", icon: Receipt, i18nKey: "nav.itcItemWise" },
          { title: "ITC — Party-wise", url: "/app/reports/itc-party-wise", icon: Receipt, i18nKey: "nav.itcPartyWise" },
        ],
      },
      {
        label: "Inventory & Outstandings",
        i18nKey: "nav.subgroup.inventoryOutstandings",
        items: [
          { title: "Stock Summary", url: "/app/reports/stock-summary", icon: Boxes, i18nKey: "nav.stockSummary" },
          { title: "Outstanding", url: "/app/reports/outstanding", icon: ClipboardList, i18nKey: "nav.outstanding" },
        ],
      },
    ],
  },
  {
    label: "Housekeeping",
    i18nKey: "nav.section.housekeeping",
    icon: Wrench,
    items: [
      { title: "Accounting Tools", url: "/app/housekeeping", icon: Wrench, i18nKey: "nav.accountingTools" },
      { title: "Bank Reconciliation", url: "/app/bank", icon: Landmark, i18nKey: "nav.bankRecon" },
      { title: "BRS (Book vs Bank)", url: "/app/reports/brs", icon: Landmark, i18nKey: "nav.brs" },
      { title: "E-Invoice / EWB", url: "/app/einvoice", icon: FileCode2, i18nKey: "nav.einvoice" },
      { title: "AI Assistant", url: "/app/assistant", icon: Sparkles, i18nKey: "nav.aiAssistant" },
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
]);

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { activeMembership } = useCompany();
  const { t } = useI18n();
  const gstEnabled = activeMembership?.companies?.gst_registered ?? false;
  const inventoryEnabled = activeMembership?.companies?.inventory_enabled ?? true;

  const tt = (item: { title: string; i18nKey?: string }) =>
    item.i18nKey ? t(item.i18nKey) : item.title;

  const filterItems = (items: NavItem[]) =>
    items.filter(
      (i) =>
        (gstEnabled || !GST_URLS.has(i.url)) &&
        (inventoryEnabled || !INVENTORY_URLS.has(i.url)),
    );

  const visibleSections = useMemo(
    () =>
      SECTIONS.map((s) => {
        const items = filterItems(s.items);
        const subGroups = s.subGroups
          ?.map((g) => ({ ...g, items: filterItems(g.items) }))
          .filter((g) => g.items.length > 0);
        return { ...s, items, subGroups };
      }).filter((s) => s.items.length > 0 || (s.subGroups && s.subGroups.length > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gstEnabled, inventoryEnabled],
  );

  const isActive = (url: string) =>
    url === "/app" ? location.pathname === "/app" : location.pathname === url;

  const sectionHasActive = (section: NavSection) => {
    const all = [...section.items, ...(section.subGroups?.flatMap((g) => g.items) ?? [])];
    return all.some((i) =>
      i.url === "/app" ? location.pathname === "/app" : location.pathname.startsWith(i.url),
    );
  };

  const subGroupHasActive = (group: NavSubGroup) =>
    group.items.some((i) => location.pathname.startsWith(i.url));

  // Track which sections / sub-groups are open.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    SECTIONS.forEach((s) => {
      o[s.label] = sectionHasActive(s) || s.label === "Company";
      s.subGroups?.forEach((g) => {
        o[`${s.label}::${g.label}`] = subGroupHasActive(g);
      });
    });
    return o;
  });

  useEffect(() => {
    setOpenMap((current) => {
      const next = { ...current };
      let changed = false;

      visibleSections.forEach((section) => {
        if (section.label !== "Company" && sectionHasActive(section) && !next[section.label]) {
          next[section.label] = true;
          changed = true;
        }
        section.subGroups?.forEach((g) => {
          const key = `${section.label}::${g.label}`;
          if (subGroupHasActive(g) && !next[key]) {
            next[key] = true;
            changed = true;
          }
        });
      });

      return changed ? next : current;
    });
  }, [location.pathname, visibleSections]);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground font-bold">
            म
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">{t("header.brand")}</span>
              <span className="text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
                {t("header.tagline")}
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleSections.map((section) => {
          // When collapsed, render flat icon list (no collapsible groups)
          if (collapsed) {
            const flat = [
              ...section.items,
              ...(section.subGroups?.flatMap((g) => g.items) ?? []),
            ];
            return (
              <SidebarGroup key={section.label}>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {flat.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={tt(item)}>
                          <Link to={item.url}>
                            <item.icon className="h-4 w-4" />
                            <span>{tt(item)}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          // Special-cased Company section: hover-flyout with company picker.
          if (section.label === "Company") {
            return (
              <SidebarGroup key={section.label}>
                <SidebarGroupContent>
                  <CompanyFlyout />
                </SidebarGroupContent>
              </SidebarGroup>
            );
          }

          const open = openMap[section.label] ?? false;
          return (
            <Collapsible
              key={section.label}
              open={open}
              onOpenChange={(v) => setOpenMap((m) => ({ ...m, [section.label]: v }))}
            >
              <SidebarGroup>
                <SidebarGroupLabel asChild>
                  <CollapsibleTrigger className="group/label flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                    <span className="flex items-center gap-2">
                      <section.icon className="h-3.5 w-3.5" />
                      {section.i18nKey ? t(section.i18nKey) : section.label}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
                    />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent className="overflow-hidden">
                  <SidebarGroupContent>
                    <SidebarMenuSub>
                      {section.items.map((item) => (
                        <SidebarMenuSubItem key={item.url}>
                          <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                            <Link to={item.url}>
                              <item.icon className="h-3.5 w-3.5" />
                              <span>{tt(item)}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>

                    {section.subGroups?.map((group) => {
                      const gKey = `${section.label}::${group.label}`;
                      const gOpen = openMap[gKey] ?? false;
                      return (
                        <Collapsible
                          key={gKey}
                          open={gOpen}
                          onOpenChange={(v) => setOpenMap((m) => ({ ...m, [gKey]: v }))}
                        >
                          <CollapsibleTrigger className="mt-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
                            <span>{group.i18nKey ? t(group.i18nKey) : group.label}</span>
                            <ChevronDown
                              className={`h-3 w-3 transition-transform ${gOpen ? "rotate-0" : "-rotate-90"}`}
                            />
                          </CollapsibleTrigger>
                          <CollapsibleContent className="overflow-hidden">
                            <SidebarMenuSub>
                              {group.items.map((item) => (
                                <SidebarMenuSubItem key={item.url}>
                                  <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                                    <Link to={item.url}>
                                      <item.icon className="h-3.5 w-3.5" />
                                      <span>{tt(item)}</span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
