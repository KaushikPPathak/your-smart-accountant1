// One composite maintenance run for the local-only build. Read-only: it checks
// this PC's books and environment and changes nothing.
//   - books integrity   (debit = credit, orphan lines, empty vouchers)
//   - voucher numbering (duplicate numbers per voucher type)
//   - environment       (database, ledgers, cash/bank, settings, browser, libs, backup age)
import { offlineDb as db } from "@/lib/offline/db";
import { readVouchers, readVoucherEntriesForCompany } from "@/lib/offline/cache-read";

export type CheckStatus = "ok" | "warn" | "error";

export interface MaintenanceCheck {
  key: string;
  label: string;
  status: CheckStatus;
  message: string;
}

export interface UnbalancedVoucher {
  id: string;
  voucher_number: string;
  voucher_date: string;
  voucher_type: string;
  dr: number;
  cr: number;
  diff: number;
}

export interface IntegrityResult {
  checkedVouchers: number;
  unbalanced: UnbalancedVoucher[];
  /** Posting lines whose voucher does not exist on this PC at all. */
  orphanEntries: number;
  /** Posting lines still attached to a voucher that was deleted. */
  linesOnDeletedVouchers: number;
  /** Live vouchers that have no posting lines. */
  emptyVouchers: number;
}

export interface NumberingResult {
  voucherType: string;
  count: number;
  duplicates: string[];
}

export interface MaintenanceReport {
  ranAt: string;
  integrity: IntegrityResult;
  numbering: NumberingResult[];
  checks: MaintenanceCheck[];
}

async function integrityCheck(companyId: string): Promise<IntegrityResult> {
  const live = (await readVouchers(companyId)) as any[];
  const allRows = (await db.cache_vouchers.where("company_id").equals(companyId).toArray()) as any[];
  const allIds = new Set(allRows.map((v) => String(v.id)));
  const deletedIds = new Set(allRows.filter((v) => v?.is_deleted === true).map((v) => String(v.id)));

  const entries = await readVoucherEntriesForCompany(companyId);
  const totals = new Map<string, { dr: number; cr: number; lines: number }>();
  let orphanEntries = 0;
  let linesOnDeletedVouchers = 0;
  for (const e of entries as any[]) {
    const vid = String(e.voucher_id ?? "");
    if (!allIds.has(vid)) {
      orphanEntries++;
      continue;
    }
    if (deletedIds.has(vid)) {
      linesOnDeletedVouchers++;
      continue;
    }
    const cur = totals.get(vid) ?? { dr: 0, cr: 0, lines: 0 };
    cur.dr += Number(e.debit_paise) || 0;
    cur.cr += Number(e.credit_paise) || 0;
    cur.lines += 1;
    totals.set(vid, cur);
  }

  const unbalanced: UnbalancedVoucher[] = [];
  let emptyVouchers = 0;
  for (const v of live) {
    const id = String(v.id);
    const t = totals.get(id) ?? { dr: 0, cr: 0, lines: 0 };
    if (t.lines === 0) emptyVouchers++;
    if (t.dr !== t.cr) {
      unbalanced.push({
        id,
        voucher_number: String(v.voucher_number ?? ""),
        voucher_date: String(v.voucher_date ?? ""),
        voucher_type: String(v.voucher_type ?? ""),
        dr: t.dr,
        cr: t.cr,
        diff: t.dr - t.cr,
      });
    }
  }
  return { checkedVouchers: live.length, unbalanced, orphanEntries, linesOnDeletedVouchers, emptyVouchers };
}

/** Same voucher number used twice within one voucher type (live vouchers only). */
async function numberingCheck(companyId: string): Promise<NumberingResult[]> {
  const live = (await readVouchers(companyId)) as any[];
  const byType = new Map<string, Map<string, number>>();
  for (const v of live) {
    const type = String(v.voucher_type ?? "");
    const num = String(v.voucher_number ?? "").trim();
    if (!num) continue;
    const m = byType.get(type) ?? new Map<string, number>();
    m.set(num, (m.get(num) ?? 0) + 1);
    byType.set(type, m);
  }
  return [...byType.entries()].map(([voucherType, m]) => ({
    voucherType,
    count: [...m.values()].reduce((a, b) => a + b, 0),
    duplicates: [...m.entries()].filter(([, n]) => n > 1).map(([num]) => num),
  }));
}

async function environmentChecks(companyId: string | null): Promise<MaintenanceCheck[]> {
  const out: MaintenanceCheck[] = [];
  const add = (key: string, label: string, status: CheckStatus, message: string) =>
    out.push({ key, label, status, message });

  add("auth", "Authenticated session", "ok", "Offline build: local accounts only, no cloud sign-in needed");
  add("cloud", "Cloud", "ok", "Not used in this build — books are on this PC");

  if (!companyId) {
    add("company", "Active company selected", "error", "No company selected");
    return out;
  }
  add("company", "Active company selected", "ok", `Company id ${companyId.slice(0, 8)}…`);

  try {
    await db.open();
    const settings = await db.cache_company_settings.where("company_id").equals(companyId).count();
    add("database", "Local database readable", "ok", "Books database opens on this PC");
    add(
      "settings",
      "Company settings row present",
      settings > 0 ? "ok" : "warn",
      settings > 0 ? "Settings row present" : "Settings row missing — open Settings once",
    );
  } catch (e) {
    add("database", "Local database readable", "error", (e as Error).message || "Could not open the books database");
  }

  const ledgers = await db.cache_ledgers.where("company_id").equals(companyId).toArray().catch(() => [] as any[]);
  add(
    "ledgers",
    "Has at least one ledger",
    ledgers.length ? "ok" : "warn",
    ledgers.length ? `${ledgers.length} ledger${ledgers.length === 1 ? "" : "s"}` : "No ledgers yet — create one or import opening balances",
  );
  const cb = ledgers.filter((r: any) => r?.type === "cash" || r?.type === "bank");
  add(
    "cash_bank",
    "Cash / Bank ledger configured",
    cb.length ? "ok" : "warn",
    cb.length ? `${cb.length} cash / bank ledger${cb.length === 1 ? "" : "s"}` : "No Cash/Bank ledger — receipts & payments need one",
  );

  const missing: string[] = [];
  try {
    localStorage.setItem("__selftest__", "1");
    localStorage.removeItem("__selftest__");
  } catch {
    missing.push("localStorage");
  }
  if (typeof indexedDB === "undefined") missing.push("IndexedDB");
  if (typeof File === "undefined" || typeof Blob === "undefined") missing.push("File/Blob");
  add(
    "browser",
    "Browser features (storage, file, print)",
    missing.length ? "warn" : "ok",
    missing.length ? `Missing: ${missing.join(", ")}` : "localStorage, IndexedDB, File, print()",
  );

  const [pdf, xlsx] = await Promise.allSettled([import("jspdf"), import("exceljs")]);
  const broken = [pdf.status === "rejected" ? "PDF" : null, xlsx.status === "rejected" ? "Excel" : null].filter(Boolean);
  add(
    "export_libs",
    "PDF / Excel export libraries load",
    broken.length ? "error" : "ok",
    broken.length ? `Failed to load: ${broken.join(", ")}` : "PDF + Excel libraries loaded",
  );

  let last: string | null = null;
  try {
    last = localStorage.getItem(`lastBackup:${companyId}`);
  } catch {
    /* reported below */
  }
  if (!last) {
    add("backup_age", "Recent backup on this PC", "warn", "No backup recorded — export one now");
  } else {
    const days = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);
    add(
      "backup_age",
      "Recent backup on this PC",
      days >= 14 ? "error" : days >= 7 ? "warn" : "ok",
      days >= 14
        ? `Last backup ${days} days ago — overdue`
        : days >= 7
          ? `Last backup ${days} days ago — due soon`
          : `Last backup ${days} day${days === 1 ? "" : "s"} ago`,
    );
  }
  return out;
}

/** The one maintenance run used by Verify Books, Recompute and Self-test. */
export async function runMaintenanceLocal(companyId: string | null): Promise<MaintenanceReport> {
  const empty: IntegrityResult = { checkedVouchers: 0, unbalanced: [], orphanEntries: 0, linesOnDeletedVouchers: 0, emptyVouchers: 0 };
  const integrity = companyId ? await integrityCheck(companyId) : empty;
  const numbering = companyId ? await numberingCheck(companyId) : [];
  const checks = await environmentChecks(companyId);

  const dupTotal = numbering.reduce((a, n) => a + n.duplicates.length, 0);
  checks.push({
    key: "numbering",
    label: "Voucher numbers unique",
    status: dupTotal ? "error" : "ok",
    message: dupTotal
      ? `${dupTotal} duplicate number${dupTotal === 1 ? "" : "s"} across ${numbering.filter((n) => n.duplicates.length).map((n) => n.voucherType).join(", ")}`
      : `No duplicates across ${numbering.length} voucher type${numbering.length === 1 ? "" : "s"}`,
  });
  checks.push({
    key: "integrity",
    label: "Books balance (debit = credit)",
    status: integrity.unbalanced.length ? "error" : "ok",
    message: integrity.unbalanced.length
      ? `${integrity.unbalanced.length} unbalanced voucher${integrity.unbalanced.length === 1 ? "" : "s"}`
      : `${integrity.checkedVouchers} voucher${integrity.checkedVouchers === 1 ? "" : "s"} balance`,
  });

  return { ranAt: new Date().toISOString(), integrity, numbering, checks };
}
