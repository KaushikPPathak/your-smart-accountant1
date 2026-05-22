// Income Tax Audit (Form 3CD) compute helpers — pure functions.
// All money in paise (bigint-safe integers).
import { supabase } from "@/integrations/supabase/client";
import { fetchLedgerBalances, type LedgerBalance } from "@/lib/reports";

/** Section 40A(3) threshold: cash payment to a single party in a single day. */
export const CASH_LIMIT_PAISE = 10_000_00;

/** Default Income Tax block-of-assets (Companies/Firms — common rates). */
export const DEFAULT_IT_BLOCKS = [
  { code: "BUILDING_10", name: "Buildings — Residential / Commercial", rate_pct: 10 },
  { code: "BUILDING_5", name: "Buildings — Temporary structures", rate_pct: 40 },
  { code: "FURNITURE_10", name: "Furniture & Fittings", rate_pct: 10 },
  { code: "PM_15", name: "Plant & Machinery (General)", rate_pct: 15 },
  { code: "PM_AC_15", name: "Plant & Machinery — AC, Air-cooler", rate_pct: 15 },
  { code: "MV_15", name: "Motor Vehicles (non-commercial)", rate_pct: 15 },
  { code: "MV_30", name: "Motor Vehicles (used in hire business)", rate_pct: 30 },
  { code: "COMPUTER_40", name: "Computers & Software", rate_pct: 40 },
  { code: "INTANGIBLE_25", name: "Intangible Assets (patents, copyrights)", rate_pct: 25 },
] as const;

export interface CashHit {
  ledger_id: string;
  ledger_name: string;
  voucher_id: string;
  voucher_no: string;
  date: string;
  amount_paise: number; // total cash paid to that party on that day
  voucher_count: number;
}

/**
 * Section 40A(3) — scan payment vouchers where the contra side is a CASH
 * ledger and the same-day aggregate paid to a single party ledger exceeds
 * ₹10,000. Returns flagged rows.
 */
export async function scan40A3(
  companyId: string,
  fromDate: string,
  toDate: string,
): Promise<CashHit[]> {
  // 1. Get all CASH ledgers for this company
  const { data: cashLedgers } = await supabase
    .from("ledgers")
    .select("id")
    .eq("company_id", companyId)
    .eq("type", "cash");
  const cashIds = new Set((cashLedgers ?? []).map((l) => l.id));
  if (cashIds.size === 0) return [];

  // 2. Get all payment/journal voucher entries in window
  const { data: vouchers } = await supabase
    .from("vouchers")
    .select("id, voucher_number, voucher_date")
    .eq("company_id", companyId)
    .gte("voucher_date", fromDate)
    .lte("voucher_date", toDate)
    .in("voucher_type", ["payment", "journal"]);
  const vMap = new Map(
    (vouchers ?? []).map((v) => [v.id, v]),
  );
  if (vMap.size === 0) return [];

  const { data: entries } = await supabase
    .from("voucher_entries")
    .select("voucher_id, ledger_id, debit_paise, credit_paise")
    .in("voucher_id", Array.from(vMap.keys()));

  // 3. Per voucher: find cash-credit (cash going out) and party-debit pairs
  const perVoucher = new Map<string, { cashCr: number; partyDebits: Map<string, number> }>();
  for (const e of entries ?? []) {
    let row = perVoucher.get(e.voucher_id);
    if (!row) {
      row = { cashCr: 0, partyDebits: new Map() };
      perVoucher.set(e.voucher_id, row);
    }
    if (cashIds.has(e.ledger_id)) {
      row.cashCr += e.credit_paise;
    } else if (e.debit_paise > 0) {
      row.partyDebits.set(
        e.ledger_id,
        (row.partyDebits.get(e.ledger_id) ?? 0) + e.debit_paise,
      );
    }
  }

  // 4. Aggregate (date + party) cash amount
  const agg = new Map<string, { ledger_id: string; date: string; amount: number; voucher_ids: Set<string> }>();
  for (const [vid, row] of perVoucher) {
    if (row.cashCr <= 0 || row.partyDebits.size === 0) continue;
    const v = vMap.get(vid)!;
    const totalDebit = Array.from(row.partyDebits.values()).reduce((a, b) => a + b, 0);
    if (totalDebit <= 0) continue;
    for (const [partyId, partyDr] of row.partyDebits) {
      // pro-rate cash credit by party share
      const cashShare = Math.round((partyDr / totalDebit) * row.cashCr);
      const key = `${v.voucher_date}__${partyId}`;
      let bucket = agg.get(key);
      if (!bucket) {
        bucket = { ledger_id: partyId, date: v.voucher_date, amount: 0, voucher_ids: new Set() };
        agg.set(key, bucket);
      }
      bucket.amount += cashShare;
      bucket.voucher_ids.add(vid);
    }
  }

  // 5. Resolve ledger names; keep only > limit
  const partyIds = Array.from(new Set(Array.from(agg.values()).map((a) => a.ledger_id)));
  const { data: ledgerNames } = await supabase
    .from("ledgers")
    .select("id, name")
    .in("id", partyIds);
  const nameMap = new Map((ledgerNames ?? []).map((l) => [l.id, l.name]));

  const hits: CashHit[] = [];
  for (const bucket of agg.values()) {
    if (bucket.amount <= CASH_LIMIT_PAISE) continue;
    const firstVid = Array.from(bucket.voucher_ids)[0];
    const firstV = vMap.get(firstVid)!;
    hits.push({
      ledger_id: bucket.ledger_id,
      ledger_name: nameMap.get(bucket.ledger_id) ?? "—",
      voucher_id: firstVid,
      voucher_no: firstV.voucher_number,
      date: bucket.date,
      amount_paise: bucket.amount,
      voucher_count: bucket.voucher_ids.size,
    });
  }
  hits.sort((a, b) => (a.date < b.date ? 1 : -1));
  return hits;
}

export interface Statutory43BRow {
  ledger_id: string;
  ledger_name: string;
  closing_paise: number; // outstanding (Cr balance) at fy_end
  cleared_on?: string;
  cleared_paise?: number;
  reference?: string;
}

/** Heuristic match for 43B statutory liabilities. */
export function is43BLedger(name: string, group_code: string | null): boolean {
  const n = name.toLowerCase();
  if (group_code === "DUTIES_TAXES") return true;
  return (
    /\b(gst|cgst|sgst|igst|tds|tcs|pf|epf|esic?|provident|gratuity|bonus|professional tax|labour welfare|cess)\b/.test(
      n,
    )
  );
}

export async function fetch43BSnapshot(
  companyId: string,
  fyEnd: string,
): Promise<Statutory43BRow[]> {
  const balances = await fetchLedgerBalances(companyId, fyEnd);
  const candidates = balances.filter((b) => is43BLedger(b.name, b.group_code));
  // 43B: payable balance means negative signed closing (Cr-nature). Show only Cr outstanding.
  const outstanding = candidates
    .filter((b) => b.closing_paise < 0)
    .map<Statutory43BRow>((b) => ({
      ledger_id: b.id,
      ledger_name: b.name,
      closing_paise: -b.closing_paise,
    }));

  // Merge stored clearances
  const { data: cleared } = await supabase
    .from("it_43b_clearances" as never)
    .select("ledger_id, cleared_on, cleared_paise, reference")
    .eq("company_id", companyId)
    .eq("fy_end", fyEnd);
  const cMap = new Map(
    (cleared as Array<{ ledger_id: string; cleared_on: string | null; cleared_paise: number; reference: string | null }> | null ?? []).map(
      (c) => [c.ledger_id, c],
    ),
  );
  for (const row of outstanding) {
    const c = cMap.get(row.ledger_id);
    if (c) {
      row.cleared_on = c.cleared_on ?? undefined;
      row.cleared_paise = c.cleared_paise;
      row.reference = c.reference ?? undefined;
    }
  }
  return outstanding.sort((a, b) => b.closing_paise - a.closing_paise);
}

export interface ItAsset {
  id: string;
  company_id: string;
  block_code: string;
  ledger_id: string | null;
  name: string;
  fy_start: string;
  opening_wdv_paise: number;
}
export interface ItMovement {
  id: string;
  asset_id: string;
  fy_start: string;
  kind: "addition" | "deletion";
  movement_date: string;
  amount_paise: number;
  notes: string | null;
}

export interface BlockSummary {
  code: string;
  name: string;
  rate_pct: number;
  opening_paise: number;
  additions_ge180_paise: number; // additions on/before Oct 2 (used ≥180 days)
  additions_lt180_paise: number;
  deletions_paise: number;
  depreciation_paise: number;
  closing_wdv_paise: number;
}

/** Returns true if a movement is "used ≥ 180 days" given an FY starting `fyStart`. */
export function isLongUse(movementDate: string, fyStart: string): boolean {
  // FY usually Apr 1 → Mar 31. ≥180 days means on/before Oct 3 (approx Oct 2).
  // Compute date diff to fy_end (fy_start + 1 year - 1 day).
  const start = new Date(fyStart);
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + 1);
  end.setDate(end.getDate() - 1);
  const mv = new Date(movementDate);
  const days = Math.floor((end.getTime() - mv.getTime()) / 86_400_000) + 1;
  return days >= 180;
}

export function summariseBlocks(
  blocks: { code: string; name: string; rate_pct: number }[],
  assets: ItAsset[],
  movements: ItMovement[],
  fyStart: string,
): BlockSummary[] {
  const movByAsset = new Map<string, ItMovement[]>();
  for (const m of movements) {
    const arr = movByAsset.get(m.asset_id) ?? [];
    arr.push(m);
    movByAsset.set(m.asset_id, arr);
  }
  return blocks.map((blk) => {
    let opening = 0,
      addLong = 0,
      addShort = 0,
      deletions = 0;
    for (const a of assets) {
      if (a.block_code !== blk.code) continue;
      opening += a.opening_wdv_paise;
      const mvs = movByAsset.get(a.id) ?? [];
      for (const m of mvs) {
        if (m.fy_start !== fyStart) continue;
        if (m.kind === "addition") {
          if (isLongUse(m.movement_date, fyStart)) addLong += m.amount_paise;
          else addShort += m.amount_paise;
        } else deletions += m.amount_paise;
      }
    }
    // Block-of-assets dep:
    //   full = rate × max(0, opening + addLong - deletions)
    //   half = rate × 0.5 × max(0, addShort - max(0, deletions - opening - addLong))
    const fullBase = Math.max(0, opening + addLong - deletions);
    const remainingDel = Math.max(0, deletions - opening - addLong);
    const halfBase = Math.max(0, addShort - remainingDel);
    const rate = blk.rate_pct / 100;
    const depFull = Math.round(fullBase * rate);
    const depHalf = Math.round(halfBase * rate * 0.5);
    const dep = depFull + depHalf;
    const closing = Math.max(0, opening + addLong + addShort - deletions - dep);
    return {
      code: blk.code,
      name: blk.name,
      rate_pct: blk.rate_pct,
      opening_paise: opening,
      additions_ge180_paise: addLong,
      additions_lt180_paise: addShort,
      deletions_paise: deletions,
      depreciation_paise: dep,
      closing_wdv_paise: closing,
    };
  });
}

/** Book Depreciation = sum of ledger debit balances whose name suggests depreciation expense. */
export function bookDepreciationPaise(balances: LedgerBalance[]): number {
  return balances
    .filter(
      (b) =>
        (b.type === "expense_indirect" || b.type === "expense_direct") &&
        /\bdepre/i.test(b.name),
    )
    .reduce((s, b) => s + Math.max(0, b.closing_paise), 0);
}

/** Net Profit (books) = -(income_indirect closing) - (expense_indirect closing) + trading GP. */
export function netProfitBooks(balances: LedgerBalance[]): number {
  let income = 0,
    expense = 0;
  for (const b of balances) {
    if (b.type === "income_indirect" || b.type === "income_direct") income += -b.closing_paise;
    else if (b.type === "expense_indirect" || b.type === "expense_direct")
      expense += b.closing_paise;
  }
  return income - expense;
}

export interface ComputationRow {
  label: string;
  paise: number;
  kind: "start" | "add" | "less" | "equals";
}

export function buildComputation(opts: {
  netProfitPaise: number;
  cash40A3Paise: number;
  disallow40aIaPaise: number;
  otherDisallowPaise: number;
  bookDepreciationPaise: number;
  itDepreciationPaise: number;
}): { rows: ComputationRow[]; taxablePaise: number } {
  const rows: ComputationRow[] = [
    { label: "Net Profit as per Books", paise: opts.netProfitPaise, kind: "start" },
    { label: "Add: Cash payments > ₹10,000 disallowed u/s 40A(3)", paise: opts.cash40A3Paise, kind: "add" },
    { label: "Add: Expenses disallowed u/s 40(a)(ia) — TDS non-deduction", paise: opts.disallow40aIaPaise, kind: "add" },
    { label: "Add: Other disallowances", paise: opts.otherDisallowPaise, kind: "add" },
    { label: "Add: Book Depreciation (added back)", paise: opts.bookDepreciationPaise, kind: "add" },
    { label: "Less: Depreciation as per Income Tax Act", paise: opts.itDepreciationPaise, kind: "less" },
  ];
  const taxable =
    opts.netProfitPaise +
    opts.cash40A3Paise +
    opts.disallow40aIaPaise +
    opts.otherDisallowPaise +
    opts.bookDepreciationPaise -
    opts.itDepreciationPaise;
  rows.push({ label: "Taxable Income from Business/Profession", paise: taxable, kind: "equals" });
  return { rows, taxablePaise: taxable };
}
