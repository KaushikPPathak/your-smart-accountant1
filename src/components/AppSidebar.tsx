import { Link, useLocation } from "@tanstack/react-router";
import { useState } from "react";
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

interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
}
interface NavSection {
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  requiresGst?: boolean;
}

// Busy-style top-level menu structure
const SECTIONS: NavSection[] = [
  {
    label: "Company",
    icon: Briefcase,
    items: [
      { title: "Dashboard", url: "/app", icon: LayoutDashboard },
      { title: "Companies", url: "/app/companies", icon: Building2 },
      { title: "Company Settings", url: "/app/settings", icon: Settings },
    ],
  },
  {
    label: "Administration",
    icon: ShieldCheck,
    items: [
      { title: "Ledgers / Parties", url: "/app/ledgers", icon: Users },
      { title: "Items / Stock", url: "/app/items", icon: Package },
      { title: "Recurring Invoices", url: "/app/recurring", icon: Repeat },
    ],
  },
  {
    label: "Transactions",
    icon: ArrowLeftRight,
    items: [
      { title: "All Vouchers", url: "/app/vouchers", icon: ReceiptText },
      { title: "New Sales", url: "/app/vouchers/new/sales", icon: TrendingUp },
      { title: "New Purchase", url: "/app/vouchers/new/purchase", icon: TrendingDown },
      { title: "Receipt", url: "/app/vouchers/new/receipt", icon: ArrowLeftRight },
      { title: "Payment", url: "/app/vouchers/new/payment", icon: Banknote },
      { title: "Journal", url: "/app/vouchers/new/journal", icon: BookOpen },
    ],
  },
  {
    label: "Display / Print",
    icon: Printer,
    items: [
      { title: "Reports Hub", url: "/app/reports", icon: FileBarChart },
      { title: "Day Book", url: "/app/reports/day-book", icon: CalendarClock },
      { title: "Ledger Statement", url: "/app/reports/ledger", icon: ScrollText },
      { title: "Group Ledger (B/S & P&L)", url: "/app/reports/group-ledger", icon: Layers },
      { title: "Trial Balance", url: "/app/reports/trial-balance", icon: Calculator },
      { title: "Trading Account", url: "/app/reports/trading", icon: TrendingUp },
      { title: "Profit & Loss", url: "/app/reports/profit-loss", icon: TrendingUp },
      { title: "Balance Sheet", url: "/app/reports/balance-sheet", icon: FileSpreadsheet },
      { title: "Outstanding", url: "/app/reports/outstanding", icon: ClipboardList },
      { title: "Stock Summary", url: "/app/reports/stock-summary", icon: Boxes },
      { title: "GSTR-1 / 3B / 2B", url: "/app/reports/gstr1", icon: Receipt },
      { title: "GST Sales Book", url: "/app/reports/gst-sales-book", icon: Receipt },
      { title: "GST Purchase Book", url: "/app/reports/gst-purchase-book", icon: Receipt },
    ],
  },
  {
    label: "Housekeeping",
    icon: Wrench,
    items: [
      { title: "Accounting Tools", url: "/app/housekeeping", icon: Wrench },
      { title: "Bank Reconciliation", url: "/app/bank", icon: Landmark },
      { title: "BRS (Book vs Bank)", url: "/app/reports/brs", icon: Landmark },
      { title: "E-Invoice / EWB", url: "/app/einvoice", icon: FileCode2 },
    ],
  },
];

const GST_URLS = new Set([
  "/app/reports/gstr1",
  "/app/einvoice",
  "/app/reports/gst-sales-book",
  "/app/reports/gst-purchase-book",
]);

const INVENTORY_URLS = new Set([
  "/app/items",
  "/app/reports/stock-summary",
]);

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { activeMembership } = useCompany();
  const gstEnabled = activeMembership?.companies?.gst_registered ?? false;
  const inventoryEnabled = activeMembership?.companies?.inventory_enabled ?? true;

  const visibleSections = SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter(
      (i) =>
        (gstEnabled || !GST_URLS.has(i.url)) &&
        (inventoryEnabled || !INVENTORY_URLS.has(i.url)),
    ),
  })).filter((s) => s.items.length > 0);

  const isActive = (url: string) =>
    url === "/app" ? location.pathname === "/app" : location.pathname === url;

  const sectionHasActive = (section: NavSection) =>
    section.items.some((i) =>
      i.url === "/app" ? location.pathname === "/app" : location.pathname.startsWith(i.url),
    );

  // Track which sections are open. Auto-open the section containing the active route.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    SECTIONS.forEach((s) => {
      o[s.label] = sectionHasActive(s) || s.label === "Company";
    });
    return o;
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground font-bold">
            म
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">Your Mehtaji</span>
              <span className="text-[10px] uppercase tracking-wide text-sidebar-foreground/60">
                Accounting Suite
              </span>
            </div>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {visibleSections.map((section) => {
          // When collapsed, render flat icon list (no collapsible groups)
          if (collapsed) {
            return (
              <SidebarGroup key={section.label}>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {section.items.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                          <Link to={item.url}>
                            <item.icon className="h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
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
                      {section.label}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
                    />
                  </CollapsibleTrigger>
                </SidebarGroupLabel>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenuSub>
                      {section.items.map((item) => (
                        <SidebarMenuSubItem key={item.url}>
                          <SidebarMenuSubButton asChild isActive={isActive(item.url)}>
                            <Link to={item.url}>
                              <item.icon className="h-3.5 w-3.5" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
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
