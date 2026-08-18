// Deterministic anomaly scanners over the local IndexedDB cache.
//
// These are pure functions: no LLM, no network, no cost. They power the
// morning briefing card and the "trust layer" of the assistant. Every
// finding is auditable — it carries the voucher/ledger/item ids that
// triggered it so the UI can link straight to the row.
//
// New watchers should be small, cheap, and confident. When in doubt,
// downgrade severity or skip — false alarms erode trust faster than
// missed issues.

import { readItems, readLedgers, readVouchers, readVoucherEntriesForCompany } from "@/lib/offline/cache-read";

export type AnomalySeverity = "info" | "warn" | "danger";

export interface Anomaly {
  id: string;              // stable key for dedupe/dismissal
  severity: AnomalySeverity;
  category: "duplicate" | "msme" | "stock" | "gst" | "deadline" | "balance";
  title: string;
  detail: string;
  href?: string;           // deep link (optional)
  refs?: {                 // audit trail
    voucherIds?: string[];
    ledgerIds?: string[];
    itemIds?: string[];
  };
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => {
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  return Math.round((db - da) / 86_400_000);
};

// ─────────────────────────────────────────────────────────────────────────────
// Duplicate voucher numbers within a voucher_type
// ─────────────────────────────────────────────────────────────────────────────
export async function scanDuplicateVoucherNumbers(companyId: string): Promise<Anomaly[]> {
  const vouchers = await readVouchers(companyId);
  const byKey = new Map<string, any[]>();
  for (const v of vouchers as any[]) {
    const num = String(v.voucher_number ?? "").trim();
    if (!num) continue;
    const key = `${v.voucher_type}::${num}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(v);
  }
  const out: Anomaly[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    const [type, num] = key.split("::");
    out.push({
      id: `dup:${key}`,
      severity: "warn",
      category: "duplicate",
      title: `Duplicate ${type} voucher #${num}`,
      detail: `${list.length} vouchers share this number — one may be a mistake or an unposted reversal.`,
      refs: { voucherIds: list.map((v) => String(v.id)) },
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MSMED §15 — payables to MSME parties overdue beyond 45 days
// ─────────────────────────────────────────────────────────────────────────────
export async function scanMsmeBreaches(companyId: string): Promise<Anomaly[]> {
  const [ledgers, entries, vouchers] = await Promise.all([
    readLedgers(companyId),
    readVoucherEntriesForCompany(companyId),
    readVouchers(companyId),
  ]);
  const voucherById = new Map<string, any>((vouchers as any[]).map((v) => [String(v.id), v]));
  const msmeLedgers = (ledgers as any[]).filter(
    (l) => l?.is_msme === true || l?.msme_udyam || l?.msme_type,
  );
  if (msmeLedgers.length === 0) return [];

  const today = todayISO();
  const out: Anomaly[] = [];
  for (const ledger of msmeLedgers) {
    let balance = 0; // paise, +ve = we owe them
    let oldestUnpaid = "";
    let oldestVid = "";
    for (const e of entries as any[]) {
      if (String(e.ledger_id) !== String(ledger.id)) continue;
      const v = voucherById.get(String(e.voucher_id));
      if (!v) continue;
      const dr = Number(e.debit_paise ?? 0);
      const cr = Number(e.credit_paise ?? 0);
      // creditor: credit increases what we owe
      balance += cr - dr;
      if (cr > 0 && (!oldestUnpaid || String(v.voucher_date) < oldestUnpaid)) {
        oldestUnpaid = String(v.voucher_date);
        oldestVid = String(v.id);
      }
    }
    if (balance <= 0 || !oldestUnpaid) continue;
    const age = daysBetween(oldestUnpaid, today);
    if (age <= 45) continue;
    out.push({
      id: `msme:${ledger.id}`,
      severity: age > 60 ? "danger" : "warn",
      category: "msme",
      title: `${ledger.name} · MSME payable overdue (${age} days)`,
      detail: `Balance ₹${(balance / 100).toFixed(2)} · §15 interest applies after 45 days (RBI bank rate × 3, compounded monthly).`,
      href: `/app/reports/outstanding?ledger=${ledger.id}`,
      refs: { ledgerIds: [String(ledger.id)], voucherIds: oldestVid ? [oldestVid] : undefined },
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Negative stock — items whose closing qty went below zero
// ─────────────────────────────────────────────────────────────────────────────
export async function scanNegativeStock(companyId: string): Promise<Anomaly[]> {
  const [items, vouchers] = await Promise.all([
    readItems(companyId),
    readVouchers(companyId),
  ]);
  // Aggregate voucher_items by item — pull once
  const { offlineDb } = await import("@/lib/offline/db");
  const vitems: any[] = await offlineDb.cache_voucher_items
    .where("company_id").equals(companyId).toArray();
  const voucherTypeById = new Map<string, string>(
    (vouchers as any[]).map((v) => [String(v.id), String(v.voucher_type ?? "")]),
  );
  const qtyByItem = new Map<string, number>();
  for (const vi of vitems) {
    if (vi?.is_deleted === true) continue;
    const itemId = String(vi.item_id ?? "");
    if (!itemId) continue;
    const type = voucherTypeById.get(String(vi.voucher_id)) ?? "";
    const qty = Number(vi.qty ?? 0);
    // Outflow types reduce stock, inflow types increase it
    const sign =
      type === "sales" || type === "delivery_note" || type === "stock_journal_out" ? -1 :
      type === "purchase" || type === "receipt_note" || type === "stock_journal_in" ? 1 : 0;
    if (sign === 0) continue;
    qtyByItem.set(itemId, (qtyByItem.get(itemId) ?? 0) + sign * qty);
  }
  const out: Anomaly[] = [];
  for (const item of items as any[]) {
    const opening = Number(item.opening_stock_qty ?? 0);
    const closing = opening + (qtyByItem.get(String(item.id)) ?? 0);
    if (closing < 0) {
      out.push({
        id: `negstock:${item.id}`,
        severity: "danger",
        category: "stock",
        title: `Negative stock — ${item.name}`,
        detail: `Closing quantity is ${closing.toFixed(2)}. A sale was posted without a matching purchase or opening balance.`,
        href: `/app/items`,
        refs: { itemIds: [String(item.id)] },
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GST hygiene — registered-party sales without GST, or party without GSTIN
// ─────────────────────────────────────────────────────────────────────────────
export async function scanGstHygiene(companyId: string): Promise<Anomaly[]> {
  const [ledgers, vouchers] = await Promise.all([
    readLedgers(companyId),
    readVouchers(companyId, { voucher_type: "sales" }),
  ]);
  const ledgerById = new Map<string, any>((ledgers as any[]).map((l) => [String(l.id), l]));
  const out: Anomaly[] = [];
  const missingGstinParties = new Set<string>();

  for (const v of vouchers as any[]) {
    const party = ledgerById.get(String(v.party_ledger_id));
    if (!party) continue;
    const isRegistered = !!(party.gst_registration_type && party.gst_registration_type !== "unregistered");
    if (!isRegistered) continue;
    const tax = Number(v.cgst_paise ?? 0) + Number(v.sgst_paise ?? 0) + Number(v.igst_paise ?? 0);
    const total = Number(v.total_paise ?? 0);
    if (total > 0 && tax === 0) {
      out.push({
        id: `gstmissing:${v.id}`,
        severity: "warn",
        category: "gst",
        title: `Sales #${v.voucher_number} to ${party.name} has no GST`,
        detail: `Party is GST-registered but the invoice carries zero tax. Check rate/place-of-supply.`,
        href: `/app/vouchers/${v.id}`,
        refs: { voucherIds: [String(v.id)], ledgerIds: [String(party.id)] },
      });
    }
    if (isRegistered && !party.gstin) missingGstinParties.add(String(party.id));
  }
  for (const pid of missingGstinParties) {
    const p = ledgerById.get(pid);
    if (!p) continue;
    out.push({
      id: `nogstin:${pid}`,
      severity: "warn",
      category: "gst",
      title: `${p.name} is registered but has no GSTIN saved`,
      detail: `GSTR-1 will reject B2B rows without a GSTIN. Add it in the ledger master.`,
      href: `/app/ledgers`,
      refs: { ledgerIds: [pid] },
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deadline radar — GSTR-1 (11th), GSTR-3B (20th), TDS (7th)
// ─────────────────────────────────────────────────────────────────────────────
export function scanDeadlines(companyId: string, now: Date = new Date()): Anomaly[] {
  // Check notification settings for this company.
  // Note: Since this is a pure function export, we move the actual logic to getDeadlinesAsync 
  // which is called by the master runner.
  return []; 
}

async function getDeadlinesAsync(companyId: string, now: Date = new Date()): Promise<Anomaly[]> {
  const { offlineDb } = await import("@/lib/offline/db");
  const settings = await offlineDb.cache_company_settings.where("company_id").equals(companyId).first();
  const company = await offlineDb.cache_companies.get(companyId);

  if (settings && settings.reminders_enabled === false) return [];

  const out: Anomaly[] = [];
  const y = now.getFullYear();
  const m = now.getMonth();
  const day = now.getDate();

  const isGstRegistered = company?.gst_registered || !!company?.gstin;
  const isAuditCase = settings?.audit_case_reminders;

  const targets: { name: string; day: number; href: string; monthLabel: string; requiresGst?: boolean; requiresAudit?: boolean }[] = [
    { name: "GSTR-1", day: 11, href: "/app/reports/gstr1", monthLabel: prevMonthLabel(now), requiresGst: true },
    { name: "GSTR-3B", day: 20, href: "/app/reports/gstr3b", monthLabel: prevMonthLabel(now), requiresGst: true },
    { name: "TDS deposit", day: 7, href: "/app/reports/tds", monthLabel: prevMonthLabel(now), requiresAudit: true },
  ];

  for (const t of targets) {
    if (t.requiresGst && !isGstRegistered) continue;
    if (t.requiresAudit && !isAuditCase) continue;

    // If we're past the day this month, look at next month's due
    const due = day <= t.day ? new Date(y, m, t.day) : new Date(y, m + 1, t.day);
    const daysLeft = Math.round((due.getTime() - startOfDay(now).getTime()) / 86_400_000);
    if (daysLeft > 10) continue;
    const label = daysLeft === 0 ? "due TODAY" : daysLeft === 1 ? "due tomorrow" : `due in ${daysLeft} days`;
    out.push({
      id: `deadline:${t.name}:${due.toISOString().slice(0, 10)}`,
      severity: daysLeft <= 1 ? "danger" : daysLeft <= 3 ? "warn" : "info",
      category: "deadline",
      title: `${t.name} (${t.monthLabel}) ${label}`,
      detail: `Filing due ${due.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}.`,
      href: t.href,
    });
  }
  return out;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function prevMonthLabel(d: Date): string {
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return p.toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

// ─────────────────────────────────────────────────────────────────────────────
// Master runner
// ─────────────────────────────────────────────────────────────────────────────
export async function scanAllAnomalies(companyId: string): Promise<Anomaly[]> {
  const results = await Promise.allSettled([
    scanDuplicateVoucherNumbers(companyId),
    scanMsmeBreaches(companyId),
    scanNegativeStock(companyId),
    scanGstHygiene(companyId),
    getDeadlinesAsync(companyId),
  ]);
  const out: Anomaly[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(...r.value);
  }
  // Sort by severity, danger first
  const rank: Record<AnomalySeverity, number> = { danger: 0, warn: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out;
}
