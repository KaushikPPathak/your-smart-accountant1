// Receivable / payable ageing for the local-only build.
//
// The party's ledger balance is the amount really outstanding. Receipts or
// payments that are not tied to a bill reduce that balance too. They are
// applied to the oldest open bills first, so the bills always add up to the
// ledger balance. Any balance larger than the bills (opening balance or
// unbilled debits) is shown as "unbilled" and aged as oldest.
import { readLedgers, readVouchers, readVoucherEntriesForCompany } from "@/lib/offline/cache-read";

export type Bucket = 0 | 1 | 2 | 3;
export type PartyType = "sundry_debtor" | "sundry_creditor";

export interface PartyBalance {
  partyId: string;
  name: string;
  msme: boolean;
  /** Amount outstanding in paise, always positive. */
  paise: number;
}

export interface BillInput {
  id: string;
  partyId: string;
  date: string;
  dueDate: string | null;
  totalPaise: number;
  allocatedPaise: number;
}

export interface AgedBill {
  id: string;
  partyId: string;
  pendingPaise: number;
  days: number;
  bucket: Bucket;
  /** Part of the bill cleared by unallocated receipts (oldest-first). */
  appliedOnAccountPaise: number;
}

export interface AgedResult {
  aged: AgedBill[];
  /** Outstanding balance not covered by any bill, per party. */
  unbilled: Map<string, number>;
  balances: Map<string, PartyBalance>;
}

const DAY_MS = 86_400_000;

export function bucketOf(days: number): Bucket {
  return days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
}

/** Outstanding per party from the ledger: opening balance plus all lines up to asOf. */
export async function partyBalancesLocal(
  companyId: string,
  asOf: string,
  partyType: PartyType,
): Promise<Map<string, PartyBalance>> {
  const [ledgers, vouchers, entries] = await Promise.all([
    readLedgers(companyId),
    readVouchers(companyId, { to: asOf }),
    readVoucherEntriesForCompany(companyId),
  ]);
  const inRange = new Set((vouchers as any[]).map((v) => String(v.id)));
  const movement = new Map<string, number>();
  for (const e of entries as any[]) {
    if (!inRange.has(String(e.voucher_id))) continue;
    const id = String(e.ledger_id);
    movement.set(id, (movement.get(id) || 0) + (Number(e.debit_paise) || 0) - (Number(e.credit_paise) || 0));
  }
  const out = new Map<string, PartyBalance>();
  for (const l of ledgers as any[]) {
    if (l.type !== partyType) continue;
    const id = String(l.id);
    const opening = (l.opening_balance_is_debit !== false ? 1 : -1) * (Number(l.opening_balance_paise) || 0);
    const closing = opening + (movement.get(id) || 0);
    // Receivable: debit balance is owed to us. Payable: credit balance is owed by us.
    const paise = partyType === "sundry_debtor" ? closing : -closing;
    if (paise > 0) out.set(id, { partyId: id, name: String(l.name ?? ""), msme: !!l.msme_registered, paise });
  }
  return out;
}

/**
 * Applies each party's unbilled receipts to the oldest bills, then ages what
 * remains. Bills of parties with no outstanding balance are fully cleared.
 */
export function ageBills(bills: BillInput[], balances: Map<string, PartyBalance>, asOf: string): AgedResult {
  const asOfMs = new Date(asOf).getTime();
  const byParty = new Map<string, BillInput[]>();
  for (const b of bills) {
    if (!balances.has(b.partyId)) continue;
    const list = byParty.get(b.partyId) ?? [];
    list.push(b);
    byParty.set(b.partyId, list);
  }

  const aged: AgedBill[] = [];
  const unbilled = new Map<string, number>();

  for (const [partyId, bal] of balances) {
    const list = byParty.get(partyId) ?? [];
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const remaining = sorted.map((b) => Math.max(0, b.totalPaise - b.allocatedPaise));
    const billsTotal = remaining.reduce((s, x) => s + x, 0);
    let onAccount = Math.max(0, billsTotal - bal.paise);
    if (bal.paise > billsTotal) unbilled.set(partyId, bal.paise - billsTotal);

    sorted.forEach((b, i) => {
      const applied = Math.min(remaining[i], onAccount);
      onAccount -= applied;
      const pending = remaining[i] - applied;
      if (pending <= 0) return;
      const dueIso = b.dueDate || b.date;
      const days = Math.max(0, Math.floor((asOfMs - new Date(dueIso).getTime()) / DAY_MS));
      aged.push({
        id: b.id,
        partyId,
        pendingPaise: pending,
        days,
        bucket: bucketOf(days),
        appliedOnAccountPaise: applied,
      });
    });
  }
  return { aged, unbilled, balances };
}
