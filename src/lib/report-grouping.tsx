// Helpers to convert a flat list of LedgerBalance into grouped TRow[] for
// Balance Sheet / Trading / P&L reports, following Income-Tax / Schedule III norms.
import type { ReactNode } from "react";
import type { TRow } from "@/components/reports/TAccount";
import type { LedgerBalance } from "@/lib/reports";
import {
  ACCOUNT_GROUPS,
  GROUPS_BY_SECTION,
  defaultGroupCodeForType,
  type AccountGroup,
  type AccountSection,
} from "@/lib/account-groups";
import { formatINR } from "@/lib/money";

export interface GroupBucketInner {
  label: string;
  valuePaise: number;
}

export interface GroupBucketRow {
  id: string;
  name: string;
  valuePaise: number;
  /** Optional inner breakdown (e.g. Cash / Bank / Other receipt mode). */
  inner?: GroupBucketInner[];
}

export interface GroupBucket {
  group: AccountGroup;
  rows: GroupBucketRow[];
  subtotalPaise: number;
}

/** Resolve a ledger's effective group code (column or fallback from type). */
export function ledgerGroupCode(b: { group_code: string | null; type: string }): string {
  if (b.group_code) return b.group_code;
  return defaultGroupCodeForType(b.type as never) ?? "CURRENT_ASSETS";
}

/**
 * Bucket ledgers into Schedule III groups for a given section.
 * `signFor` returns the display value (in paise) given a ledger's signed closing.
 *  - For Liabilities (Cr-natural): pass `(b) => -b.closing_paise`
 *  - For Assets (Dr-natural):       pass `(b) => b.closing_paise`
 *  - Same idea for P&L sides.
 * `innerFor` (optional) returns inner breakdown rows already sign-aligned
 * with `signFor(b)` — negative values are filtered.
 */
export function groupBalances(
  balances: LedgerBalance[],
  section: AccountSection,
  signFor: (b: LedgerBalance) => number,
  innerFor?: (b: LedgerBalance, displayValue: number) => GroupBucketInner[] | undefined,
): GroupBucket[] {
  const groupsForSection = GROUPS_BY_SECTION[section];
  const codes = new Set(groupsForSection.map((g) => g.code));
  const buckets = new Map<string, GroupBucket>();
  for (const g of groupsForSection) {
    buckets.set(g.code, { group: g, rows: [], subtotalPaise: 0 });
  }
  for (const b of balances) {
    const code = ledgerGroupCode(b);
    if (!codes.has(code)) continue;
    let v = signFor(b);
    if (!v) continue;

    // Swaps are handled at the report route level (e.g., in Balance Sheet)
    // to ensure professional partitioning. 
    // Sign is handled by the caller-provided signFor(b).

    const bucket = buckets.get(code)!;
    const inner = innerFor?.(b, v)?.filter((x) => x.valuePaise !== 0);
    bucket.rows.push({ id: b.id, name: b.name, valuePaise: v, inner: inner && inner.length > 0 ? inner : undefined });
    bucket.subtotalPaise += v;
  }
  // Drop empty groups, preserve order
  return groupsForSection.map((g) => buckets.get(g.code)!).filter((b) => b.rows.length > 0);
}

/**
 * Render grouped buckets into TRow[] suitable for <TAccount>.
 * Each non-empty group contributes:
 *   - a bold group header row (label only, no amount)
 *   - one indented row per ledger (amount on right, with optional onClick)
 *   - a subtotal row (italic-bold) with the group total
 * Returns the rows plus the section grand total in paise.
 */
export function groupedTRows(
  buckets: GroupBucket[],
  onLedgerClick?: (ledgerId: string) => void,
  labelFor?: (code: string, fallback: string) => string,
): { rows: TRow[]; totalPaise: number } {
  const rows: TRow[] = [];
  let total = 0;
  for (const b of buckets) {
    const groupLabelText = labelFor ? labelFor(b.group.code, b.group.label) : b.group.label;
    rows.push({
      label: <span className="uppercase tracking-wide text-[11px]">{groupLabelText}</span>,
      amount: "",
      emphasis: "bold",
    });
    for (const r of b.rows) {
      if (r.inner && r.inner.length > 0) {
        // Ledger row: name on left, total in OUTER column.
        rows.push({
          label: <span className="pl-3 font-medium">{r.name}</span> as ReactNode,
          amount: "",
          outerAmount: formatINR(r.valuePaise),
          onClick: onLedgerClick ? () => onLedgerClick(r.id) : undefined,
          emphasis: "bold",
        });
        // Inner mode-split rows: label indented further, value in INNER column.
        for (const inn of r.inner) {
          rows.push({
            label: <span className="pl-8 text-muted-foreground">{inn.label}</span> as ReactNode,
            amount: formatINR(inn.valuePaise),
          });
        }
      } else {
        rows.push({
          label: <span className="pl-3">{r.name}</span> as ReactNode,
          amount: formatINR(r.valuePaise),
          onClick: onLedgerClick ? () => onLedgerClick(r.id) : undefined,
        });
      }
    }
    rows.push({
      label: <span className="pl-3 italic text-muted-foreground">Subtotal — {groupLabelText}</span>,
      amount: "",
      outerAmount: formatINR(b.subtotalPaise),
      emphasis: "total",
    });
    total += b.subtotalPaise;
  }
  return { rows, totalPaise: total };
}

/** Plain rows for CSV / XLSX / PDF exports of grouped buckets. */
export function groupedExportRows(
  buckets: GroupBucket[],
  prefix: "" | "To " | "By " = "",
): { label: string; paise: number; outerPaise?: number; isHeader?: boolean; isSubtotal?: boolean }[] {
  const out: { label: string; paise: number; outerPaise?: number; isHeader?: boolean; isSubtotal?: boolean }[] = [];
  for (const b of buckets) {
    out.push({ label: b.group.label.toUpperCase(), paise: 0, isHeader: true });
    for (const r of b.rows) {
      if (r.inner && r.inner.length > 0) {
        out.push({ label: `  ${prefix}${r.name}`, paise: 0, outerPaise: r.valuePaise, isSubtotal: true });
        for (const inn of r.inner) {
          out.push({ label: `      ${inn.label}`, paise: inn.valuePaise });
        }
      } else {
        out.push({ label: `  ${prefix}${r.name}`, paise: r.valuePaise });
      }
    }
    out.push({ label: `  Subtotal — ${b.group.label}`, paise: 0, outerPaise: b.subtotalPaise, isSubtotal: true });
  }
  return out;
}

