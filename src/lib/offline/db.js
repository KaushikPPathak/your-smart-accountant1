// Dexie-backed offline cache database.
//
// This module is the single source of truth for IndexedDB tables used by
// the offline subsystem: outbox, credential cache, snapshot cache and
// sync cursors. All consumers import `offlineDb` (named, default, and
// legacy `db` exports kept for backwards-compatibility with dynamic
// importers).
//
// IMPORTANT: When the browser does not support IndexedDB (e.g. private
// mode on some browsers, or a server-rendered context), every operation
// falls back to a safe no-op so the app degrades gracefully instead of
// throwing "Cannot read properties of undefined" runtime errors.
import Dexie from "dexie";
// --- Dexie class ----------------------------------------------------------
// All tables are typed loosely as `any` so existing consumers
// (which keep their own row shapes) don't need to be touched.
class OfflineDatabase extends Dexie {
    companies;
    cache_companies;
    cache_company_settings;
    cache_ledgers;
    cache_items;
    cache_account_subgroups;
    cache_ledger_group_mappings;
    cache_account_group_overrides;
    cache_vouchers;
    cache_voucher_entries;
    cache_voucher_items;
    cache_bill_allocations;
    cache_voucher_export_details;
    cache_einvoice_details;
    cache_period_locks;
    cache_bom_templates;
    cache_bom_template_lines;
    cache_recurring_invoices;
    einvoice_queue;
    // Phase 1 (Busy-inspired) voucher primitives. Progressive-disclosure rule:
    // the presence of >1 row per (company, voucher_type) drives whether pickers
    // render; a single row (or zero) auto-applies silently. See voucher-resolver.
    cache_voucher_series;
    cache_tax_templates;
    cache_bill_sundries;
    cache_transport_details;
    // Cost accounting primitives (local-only). Pickers on voucher lines only
    // render when at least one cost centre exists for the active company;
    // categories are optional and further hidden until the user configures any.
    cache_cost_centres;
    cache_cost_categories;
    outbox;
    dead_letter;
    sync_cursors;
    account_creds;
    meta;
    activity_log;
    // E1 — Bank reconciliation (local-only, never synced).
    cache_bank_statements;
    cache_bank_statement_lines;
    // E4 — GSTR-2B reconciliation (local-only, never synced).
    cache_gstr2b_imports;
    cache_gstr2b_lines;
    constructor() {
        super("ym_offline_cache_v3");
        this.version(1).stores({
            companies: "id, name",
            cache_companies: "id, name, updated_at",
            cache_company_settings: "id, company_id, updated_at",
            cache_ledgers: "id, company_id, name, updated_at",
            cache_items: "id, company_id, name, updated_at",
            cache_account_subgroups: "id, company_id, updated_at",
            cache_ledger_group_mappings: "id, company_id, updated_at",
            cache_account_group_overrides: "id, company_id, updated_at",
            cache_vouchers: "id, company_id, updated_at",
            cache_voucher_entries: "id, voucher_id",
            cache_voucher_items: "id, voucher_id",
            outbox: "++id, created_at, company_id, table",
            sync_cursors: "key, company_id, table",
            account_creds: "username, user_id",
            meta: "key",
        });
        this.version(2).stores({
            cache_voucher_entries: "id, voucher_id, company_id, [company_id+voucher_id]",
            cache_voucher_items: "id, voucher_id, company_id, [company_id+voucher_id]",
            cache_bill_allocations: "id, company_id, invoice_voucher_id, payment_voucher_id",
        });
        this.version(3).stores({
            // Poison / permanently-failing outbox rows. Kept separate from `outbox`
            // so the drain loop doesn't keep retrying them forever and blocking the
            // queue. Users can inspect / retry / discard from the Data Sync screen.
            dead_letter: "++id, moved_at, company_id, table",
        });
        this.version(4).stores({
            cache_voucher_export_details: "voucher_id, company_id, updated_at",
            cache_einvoice_details: "voucher_id, company_id, updated_at",
            cache_period_locks: "id, company_id, updated_at, return_type, period",
            cache_bom_templates: "id, company_id, output_item_id, updated_at",
            cache_bom_template_lines: "id, template_id, company_id",
            cache_recurring_invoices: "id, company_id, updated_at, is_active",
        });
        this.version(5).stores({
            // Deferred IRN / E-Way Bill generation requests. IRP / EWB portal calls
            // require the device to be online AND the Setu (or other GSP) API to be
            // reachable. When either is unavailable we queue the request here and
            // the sync worker drains it on the next successful connectivity window,
            // so users can carry on issuing invoices offline without losing the
            // pending IRN/EWB work.
            einvoice_queue: "++id, kind, voucher_id, company_id, status, created_at",
        });
        this.version(6).stores({
            // Voucher series: multiple numbering series per (company, voucher_type).
            // When exactly one row exists for a (company, voucher_type) it is auto-
            // applied and NO picker is shown. Zero rows = fall back to legacy
            // next_voucher_number(). >1 row = user must pick (rare case).
            cache_voucher_series: "id, company_id, voucher_type, [company_id+voucher_type], updated_at",
            // Tax templates (Busy STPT). Resolver in src/lib/voucher-resolver.ts
            // looks these up by (party.gst_treatment, item.hsn_code, is_interstate)
            // and only surfaces a picker when resolution is ambiguous or missing.
            cache_tax_templates: "id, company_id, gst_rate, is_interstate, updated_at",
            // Bill sundries: non-item lines (freight, packing, discount, round-off,
            // GST components). Child of voucher. Rendered on demand via "+ Add
            // charge" in the totals block — never a permanent chip strip.
            cache_bill_sundries: "id, voucher_id, company_id, sundry_type, updated_at",
            // Transport / e-way bill fields, one row per voucher. Panel stays
            // collapsed unless F7 or invoice value >= state e-way threshold.
            cache_transport_details: "voucher_id, company_id, updated_at",
        });
        this.version(7).stores({
            cache_cost_centres: "id, company_id, name, is_active, updated_at",
            cache_cost_categories: "id, company_id, name, is_active, updated_at",
        });
        // v8 — Performance: compound indexes for the hot read paths.
        // No data migration needed; Dexie only adds indexes to the existing
        // object stores. Existing queries keep working unchanged; new code
        // can opt into these compound keys for range scans.
        //   cache_vouchers:
        //     [company_id+voucher_date]              — Day Book, date-range reports
        //     [company_id+voucher_type+voucher_date] — Sales/Purchase Register
        //     [company_id+party_id+voucher_date]     — Party ledger / statement
        //   cache_voucher_entries:
        //     [company_id+ledger_id]                 — Ledger balance, Trial Balance
        this.version(8).stores({
            cache_vouchers: "id, company_id, updated_at, voucher_date, party_id, voucher_type, " +
                "[company_id+voucher_date], " +
                "[company_id+voucher_type+voucher_date], " +
                "[company_id+party_id+voucher_date]",
            cache_voucher_entries: "id, voucher_id, company_id, ledger_id, [company_id+ledger_id]",
        });
        // v9 — Lightweight, opt-in NCE activity log (local-only). See
        // src/lib/activity-log.ts. Not synced remotely; pruned on retention.
        this.version(9).stores({
            activity_log: "++id, company_id, ts, entity_type, action, [company_id+ts]",
        });
        // v10 — Bank reconciliation stores (E1). Local-only, excluded from sync
        // and from cloud backup by design (raw statements can be re-imported).
        this.version(10).stores({
            cache_bank_statements: "id, company_id, bank_ledger_id, imported_at, [company_id+bank_ledger_id]",
            cache_bank_statement_lines: "id, statement_id, company_id, txn_date, match_status, " +
                "[company_id+bank_ledger_id+txn_date], [statement_id+txn_date]",
        });
        // v11 — GSTR-2B reconciliation stores (E4). Local-only: the downloaded 2B
        // file and its match decisions stay on this device.
        this.version(11).stores({
            cache_gstr2b_imports: "id, company_id, period, created_at, [company_id+period]",
            cache_gstr2b_lines: "id, import_id, company_id, match_status, supplier_gstin, " +
                "[company_id+import_id], [import_id+match_status]",
        });
    }
}
// --- Safe stub for environments without IndexedDB -------------------------
function makeStubTable() {
    const arr = [];
    return {
        async get() { return undefined; },
        async toArray() { return arr; },
        async add() { return 0; },
        async put() { return undefined; },
        async bulkPut() { return undefined; },
        async delete() { return undefined; },
        async clear() { return undefined; },
        async count() { return 0; },
        where() { return this; },
        filter() { return this; },
        equals() { return this; },
        anyOf() { return this; },
        and() { return this; },
        update() { return undefined; },
        orderBy() { return this; },
        sortBy() { return []; },
        first() { return undefined; },
    };
}
function makeStubDb() {
    const tableNames = [
        "companies", "cache_companies", "cache_company_settings",
        "cache_ledgers", "cache_items", "cache_account_subgroups",
        "cache_ledger_group_mappings", "cache_account_group_overrides",
        "cache_vouchers", "cache_voucher_entries", "cache_voucher_items", "cache_bill_allocations",
        "cache_voucher_export_details", "cache_einvoice_details", "cache_period_locks",
        "cache_bom_templates", "cache_bom_template_lines", "cache_recurring_invoices",
        "einvoice_queue",
        "cache_voucher_series", "cache_tax_templates", "cache_bill_sundries", "cache_transport_details",
        "cache_cost_centres", "cache_cost_categories",
        "outbox", "dead_letter", "sync_cursors", "account_creds", "meta",
        "activity_log",
        "cache_bank_statements", "cache_bank_statement_lines",
        "cache_gstr2b_imports", "cache_gstr2b_lines",
    ];
    const stub = {
        async transaction(_mode, ...args) {
            const fn = args.find((a) => typeof a === "function");
            return fn ? fn() : undefined;
        },
    };
    for (const n of tableNames)
        stub[n] = makeStubTable();
    return stub;
}
const hasIndexedDb = typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
let _db;
try {
    _db = hasIndexedDb ? new OfflineDatabase() : makeStubDb();
}
catch (err) {
    console.warn("Offline DB unavailable, using in-memory stub:", err);
    _db = makeStubDb();
}
export const offlineDb = _db;
export const db = _db;
export default _db;
// --- Helpers --------------------------------------------------------------
export async function setMeta(key, value) {
    try {
        await offlineDb.meta.put({ key, value });
    }
    catch {
        /* ignore */
    }
}
export async function getMeta(key) {
    try {
        const row = await offlineDb.meta.get(key);
        return row?.value;
    }
    catch {
        return undefined;
    }
}
