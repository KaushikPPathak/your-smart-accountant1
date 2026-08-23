// Read helpers for the offline cache. Components that need to render while
// offline can call these directly; pair them with the cloud query and pick
// whichever has data (or always prefer cloud while online, falling back to
// cache on error).
//
// Example:
//   const cloud = await supabase.from("ledgers").select("*").eq("company_id", c);
//   if (cloud.error) return readLedgers(c);
//   return cloud.data;
import { offlineDb } from "./db";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { normalizeAll, normalizeCompany, normalizeItem, normalizeLedger, normalizeVoucher, } from "./cache-normalizers";
const NETWORK_BLOCKED_KEY = "ym_network_blocked_at";
export function rememberNetworkBlocked() {
    if (typeof window === "undefined")
        return;
    const at = String(Date.now());
    try {
        window.__YSA_NETWORK_BLOCKED_AT = at;
    }
    catch { /* ignore */ }
    try {
        localStorage.setItem(NETWORK_BLOCKED_KEY, at);
    }
    catch { /* ignore */ }
}
export function shouldPreferOfflineCache() {
    if (isLocalOnlyMode())
        return true;
    if (typeof navigator !== "undefined" && navigator.onLine === false)
        return true;
    if (typeof window === "undefined")
        return false;
    let raw = null;
    try {
        raw = window.__YSA_NETWORK_BLOCKED_AT ?? null;
    }
    catch { /* ignore */ }
    if (!raw) {
        try {
            raw = localStorage.getItem(NETWORK_BLOCKED_KEY);
        }
        catch { /* ignore */ }
    }
    const at = Number(raw ?? 0);
    return Number.isFinite(at) && at > 0 && Date.now() - at < 30000;
}
export async function readCompanies() {
    const rows = await offlineDb.cache_companies.toArray();
    return normalizeAll(rows, normalizeCompany);
}
export async function readCompanySettings(companyId) {
    return offlineDb.cache_company_settings.where("company_id").equals(companyId).first();
}
export async function readLedgers(companyId) {
    const rows = await offlineDb.cache_ledgers.where("company_id").equals(companyId).sortBy("name");
    return normalizeAll(rows.filter((r) => r?.is_deleted !== true), normalizeLedger);
}
export async function readItems(companyId) {
    const rows = await offlineDb.cache_items.where("company_id").equals(companyId).sortBy("name");
    return normalizeAll(rows.filter((r) => r?.is_deleted !== true), normalizeItem);
}
export async function readAccountSubgroups(companyId) {
    return offlineDb.cache_account_subgroups.where("company_id").equals(companyId).toArray();
}
export async function readLedgerGroupMappings(companyId) {
    return offlineDb.cache_ledger_group_mappings.where("company_id").equals(companyId).toArray();
}
export async function readVouchers(companyId, opts) {
    let coll = offlineDb.cache_vouchers.where("company_id").equals(companyId);
    coll = coll.filter((v) => {
        if (v?.is_deleted === true)
            return false;
        if (opts?.voucher_type && v.voucher_type !== opts.voucher_type)
            return false;
        if (opts?.from && v.voucher_date < opts.from)
            return false;
        if (opts?.to && v.voucher_date > opts.to)
            return false;
        return true;
    });
    const rows = await coll.toArray();
    const normalized = normalizeAll(rows, normalizeVoucher);
    return normalized.sort((a, b) => (a.voucher_date < b.voucher_date ? 1 : -1));
}
export async function readVoucherEntriesForCompany(companyId) {
    const direct = await offlineDb.cache_voucher_entries.where("company_id").equals(companyId).toArray();
    // Backward-compatible recovery for caches created before company_id was
    // stored on child rows. We intentionally MERGE this with direct rows rather
    // than returning early, because a failed/interrupted sync may leave only some
    // children stamped with company_id. Returning only `direct` was the source of
    // "offline reports show partial/no transactions" even after sync said done.
    const vouchers = await readVouchers(companyId);
    const ids = vouchers.map((v) => v.id).filter(Boolean);
    if (ids.length === 0)
        return direct;
    const seen = new Set(direct.map((r) => String(r.id)));
    const out = [];
    for (let i = 0; i < ids.length; i += 500) {
        const rows = await offlineDb.cache_voucher_entries.where("voucher_id").anyOf(ids.slice(i, i + 500)).toArray();
        for (const r of rows) {
            const id = String(r.id);
            if (!seen.has(id)) {
                seen.add(id);
                out.push({ ...r, company_id: r.company_id ?? companyId });
            }
        }
    }
    return [...direct, ...out];
}
export async function readVoucherItemsForCompany(companyId) {
    const direct = await offlineDb.cache_voucher_items.where("company_id").equals(companyId).toArray();
    const vouchers = await readVouchers(companyId);
    const ids = vouchers.map((v) => v.id).filter(Boolean);
    if (ids.length === 0)
        return direct;
    const seen = new Set(direct.map((r) => String(r.id)));
    const out = [];
    for (let i = 0; i < ids.length; i += 500) {
        const rows = await offlineDb.cache_voucher_items.where("voucher_id").anyOf(ids.slice(i, i + 500)).toArray();
        for (const r of rows) {
            const id = String(r.id);
            if (!seen.has(id)) {
                seen.add(id);
                out.push({ ...r, company_id: r.company_id ?? companyId });
            }
        }
    }
    return [...direct, ...out];
}
export async function readVoucherEntriesWithVouchers(companyId, opts) {
    const [vouchers, entries] = await Promise.all([
        readVouchers(companyId),
        readVoucherEntriesForCompany(companyId),
    ]);
    const voucherById = new Map(vouchers.map((v) => [String(v.id), v]));
    return entries
        .map((e) => {
        const v = voucherById.get(String(e.voucher_id));
        if (!v)
            return null;
        const voucherDate = String(v.voucher_date ?? v.date ?? "");
        if (opts?.ledgerId && String(e.ledger_id) !== opts.ledgerId)
            return null;
        if (opts?.from && voucherDate < opts.from)
            return null;
        if (opts?.to && voucherDate > opts.to)
            return null;
        if (opts?.before && voucherDate >= opts.before)
            return null;
        return {
            ...e,
            vouchers: {
                id: String(v.id),
                voucher_date: voucherDate,
                voucher_number: String(v.voucher_number ?? ""),
                voucher_type: String(v.voucher_type ?? ""),
                narration: v.narration ?? null,
                reference_no: v.reference_no ?? null,
                company_id: companyId,
            },
        };
    })
        .filter(Boolean);
}
export async function readBillAllocations(companyId) {
    return offlineDb.cache_bill_allocations.where("company_id").equals(companyId).toArray();
}
export async function readVoucherEntries(voucherId) {
    return offlineDb.cache_voucher_entries.where("voucher_id").equals(voucherId).toArray();
}
export async function readVoucherItems(voucherId) {
    return offlineDb.cache_voucher_items.where("voucher_id").equals(voucherId).toArray();
}
/** Cache-aware fetch: try the cloud loader; on any error/empty, fall back. */
export async function withCacheFallback(cloud, cache) {
    if (shouldPreferOfflineCache()) {
        try {
            return await cache();
        }
        catch {
            // If the local cache is not available, still try cloud below.
        }
    }
    try {
        return await cloud();
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? "");
        if (/failed to fetch|failed to send a request|networkerror|offline/i.test(msg)) {
            rememberNetworkBlocked();
        }
        return await cache();
    }
}
/**
 * Unified fetcher for accounting reports. Returns a complete dataset
 * (ledgers, vouchers, entries) for a company and date range.
 */
export async function readAccountingDataset(companyId, opts) {
    const [ledgers, vouchers, rawEntries] = await Promise.all([
        readLedgers(companyId),
        readVouchers(companyId, opts),
        readVoucherEntriesForCompany(companyId),
    ]);
    const voucherById = new Map(vouchers.map((v) => [String(v.id), v]));
    const entries = rawEntries
        .map((e) => {
        const v = voucherById.get(String(e.voucher_id));
        if (!v)
            return null;
        const date = String(v.voucher_date ?? v.date ?? "");
        if (opts?.from && date < opts.from)
            return null;
        if (opts?.to && date > opts.to)
            return null;
        return {
            ledger_id: String(e.ledger_id ?? ""),
            debit_paise: Number(e.debit_paise ?? 0),
            credit_paise: Number(e.credit_paise ?? 0),
            vouchers: {
                voucher_type: v.voucher_type ?? null,
                narration: v.narration ?? null,
                voucher_id: String(v.id),
            },
        };
    })
        .filter((e) => e !== null);
    return { ledgers: ledgers, entries };
}
