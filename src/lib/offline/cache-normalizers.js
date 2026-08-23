// Self-healing normalizers for rows read from the Dexie cache.
//
// The cache is a mirror of Supabase rows written under whatever schema
// existed at the time. When we add a new column later, old rows in
// IndexedDB simply omit that key — spreading them over defaults leaves
// the field silently at its default (`false`, `null`, `0`) even when the
// server-side truth is different. That is the root cause of an entire
// class of "menu missing / field empty / picker blank" bugs we saw
// after schema migrations.
//
// The fix: every read goes through a normalizer that fills in the
// derived-or-default value. Old rows heal on next read. When a new
// field is added later, add one line here and every existing cached
// row self-repairs.
import { GST_STATE_CODES } from "@/utils/stateCodes";
import { LEDGER_TYPES } from "@/lib/constants";
import { ACCOUNT_GROUPS, GROUP_BY_CODE, defaultGroupCodeForType, defaultLedgerTypeForGroup, guessGroupCode, } from "@/lib/account-groups";
/** GSTIN's first two chars = state code. Safe fallback when the row omits state_code. */
function deriveStateCodeFromGstin(gstin) {
    if (typeof gstin !== "string" || gstin.length < 2)
        return null;
    const prefix = gstin.slice(0, 2);
    return GST_STATE_CODES[prefix] ? prefix : null;
}
/** Normalize a `cache_companies` row. Idempotent. */
export function normalizeCompany(row) {
    if (!row || typeof row !== "object")
        return null;
    const out = { ...row };
    // If a GSTIN was ever captured, the company is by definition GST-registered.
    if (out.gstin && !out.gst_registered)
        out.gst_registered = true;
    if (out.gst_registered == null)
        out.gst_registered = false;
    if (out.inventory_enabled == null)
        out.inventory_enabled = true;
    if (out.gst_filing_frequency == null)
        out.gst_filing_frequency = "monthly";
    if (out.entity_status == null)
        out.entity_status = "individual";
    if (out.currency_code == null)
        out.currency_code = "INR";
    if (out.date_format == null)
        out.date_format = "dd-mm-yyyy";
    // Local-only mode is the default posture of this app — every company keeps
    // a continuous local copy on the PC. Default missing `mode` to "trial_local"
    // so the "Trial books" tick survives fresh installs and cloud snapshots
    // that predate the column. Users who explicitly set mode="normal" keep it.
    if (out.mode == null)
        out.mode = "trial_local";
    if (out.annual_turnover_paise == null)
        out.annual_turnover_paise = 0;
    if (out.share_capital_paise == null)
        out.share_capital_paise = 0;
    if (out.corpus_fund_paise == null)
        out.corpus_fund_paise = 0;
    if (out.reminders_enabled == null)
        out.reminders_enabled = true;
    if (out.audit_case_reminders == null)
        out.audit_case_reminders = false;
    if (!out.state_code) {
        const derived = deriveStateCodeFromGstin(out.gstin);
        if (derived)
            out.state_code = derived;
    }
    if (!out.financial_year_start) {
        const y = new Date().getFullYear();
        const cy = new Date().getMonth() < 3 ? y - 1 : y;
        out.financial_year_start = `${cy}-04-01`;
    }
    return out;
}
/** Normalize a `cache_ledgers` row. */
export function normalizeLedger(row) {
    if (!row || typeof row !== "object")
        return null;
    const out = { ...row };
    if (out.is_active == null)
        out.is_active = true;
    if (out.is_deleted == null)
        out.is_deleted = false;
    if (out.opening_balance_paise == null)
        out.opening_balance_paise = 0;
    if (out.opening_balance_is_debit == null)
        out.opening_balance_is_debit = true;
    if (out.credit_limit_paise == null)
        out.credit_limit_paise = 0;
    if (out.credit_days == null)
        out.credit_days = 0;
    if (out.gst_treatment == null && out.gstin)
        out.gst_treatment = "regular";
    // Backups/imports created before account classification was introduced can
    // omit `type`, `group_code`, or the opening Dr/Cr flag. Those rows rendered
    // correctly but failed ledger edit validation with the unhelpful "Required"
    // message. Recover the strongest available classification without changing
    // already-valid values.
    const validType = LEDGER_TYPES.some((candidate) => candidate.value === out.type);
    let groupCode = typeof out.group_code === "string" && GROUP_BY_CODE[out.group_code]
        ? out.group_code
        : null;
    if (!groupCode && typeof out.group_name === "string") {
        const legacyGroup = out.group_name.trim().toLowerCase();
        groupCode = ACCOUNT_GROUPS.find((group) => group.code.toLowerCase() === legacyGroup || group.label.toLowerCase() === legacyGroup)?.code ?? null;
    }
    if (!validType) {
        const side = out.opening_balance_is_debit === false ? "Cr" : "Dr";
        const hasPartyDetails = Boolean(out.gstin || out.pan || out.credit_days || out.credit_limit_paise || out.msme_registered);
        if (!groupCode && hasPartyDetails) {
            groupCode = side === "Dr" ? "SUNDRY_DEBTORS" : "SUNDRY_CREDITORS";
        }
        if (!groupCode) {
            groupCode = guessGroupCode(`${String(out.name ?? "")} ${String(out.group_name ?? "")}`, side);
        }
        out.type = defaultLedgerTypeForGroup(groupCode);
    }
    if (!groupCode)
        groupCode = defaultGroupCodeForType(out.type);
    out.group_code = groupCode;
    return out;
}
/** Normalize a `cache_items` row. */
export function normalizeItem(row) {
    if (!row || typeof row !== "object")
        return null;
    const out = { ...row };
    if (out.is_active == null)
        out.is_active = true;
    if (out.is_deleted == null)
        out.is_deleted = false;
    if (out.gst_rate == null)
        out.gst_rate = 0;
    if (out.opening_qty == null)
        out.opening_qty = 0;
    if (out.opening_value_paise == null)
        out.opening_value_paise = 0;
    if (out.unit == null)
        out.unit = "NOS";
    return out;
}
/** Normalize a `cache_vouchers` row. */
export function normalizeVoucher(row) {
    if (!row || typeof row !== "object")
        return null;
    const out = { ...row };
    if (out.is_deleted == null)
        out.is_deleted = false;
    if (out.total_amount_paise == null)
        out.total_amount_paise = 0;
    return out;
}
/** Batch helper. Drops nulls (rows too malformed to salvage). */
export function normalizeAll(rows, fn) {
    if (!rows)
        return [];
    const out = [];
    for (const r of rows) {
        const n = fn(r);
        if (n)
            out.push(n);
    }
    return out;
}
