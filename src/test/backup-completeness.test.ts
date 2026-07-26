// Round-trip test for the v2 backup schema — proves that the 14 collections
// previously missing from backups (e-invoicing, period locks, BOM, tax
// templates, bill sundries, transport, cost centres, custom voucher series,
// account-group overrides) now survive a full export -> wipe -> restore
// cycle in local-only mode.
//
// This is the guard for the "100% data retrieval" promise. If any of these
// tables ever regresses to not being captured, this test fails.

import { describe, it, expect, beforeEach } from "vitest";
import { offlineDb } from "@/lib/offline/db";
import { buildCompanyBackup, restoreCompanyBackup, CURRENT_BACKUP_SCHEMA } from "@/lib/backup";

const COMPANY_ID = "co-v2-round-trip";

async function wipeCompany(): Promise<void> {
  const tables = [
    offlineDb.cache_companies, offlineDb.cache_company_settings,
    offlineDb.cache_ledgers, offlineDb.cache_items,
    offlineDb.cache_vouchers, offlineDb.cache_voucher_entries,
    offlineDb.cache_voucher_items, offlineDb.cache_bill_allocations,
    offlineDb.cache_recurring_invoices,
    offlineDb.cache_account_subgroups, offlineDb.cache_ledger_group_mappings,
    offlineDb.cache_account_group_overrides,
    offlineDb.cache_voucher_export_details, offlineDb.cache_einvoice_details,
    offlineDb.cache_period_locks,
    offlineDb.cache_bom_templates, offlineDb.cache_bom_template_lines,
    offlineDb.cache_voucher_series, offlineDb.cache_tax_templates,
    offlineDb.cache_bill_sundries, offlineDb.cache_transport_details,
    offlineDb.cache_cost_centres, offlineDb.cache_cost_categories,
    offlineDb.meta,
  ];
  await Promise.all(tables.map((t) => t.clear()));
}

async function seed(): Promise<void> {
  const now = new Date().toISOString();
  const base = { company_id: COMPANY_ID, updated_at: now };
  await offlineDb.cache_companies.put({ id: COMPANY_ID, name: "V2 Traders", updated_at: now });
  await offlineDb.cache_ledgers.put({ id: "led-1", name: "Cash", ...base });
  await offlineDb.cache_items.put({ id: "itm-1", name: "Widget", ...base });
  await offlineDb.cache_vouchers.put({ id: "v-1", voucher_type: "sales", voucher_number: "1", voucher_date: "2026-07-01", total_amount: 100, ...base });

  // v2 collections — one representative row each.
  await offlineDb.cache_account_subgroups.put({ id: "sg-1", name: "Sundry Debtors", ...base });
  await offlineDb.cache_ledger_group_mappings.put({ id: "map-1", ledger_id: "led-1", subgroup_id: "sg-1", ...base });
  await offlineDb.cache_account_group_overrides.put({ id: "ov-1", ledger_id: "led-1", group_name: "Cash-in-hand", ...base });
  await offlineDb.cache_voucher_export_details.put({ voucher_id: "v-1", irn: "IRN-XYZ", ...base });
  await offlineDb.cache_einvoice_details.put({ voucher_id: "v-1", ack_no: "ACK-123", ...base });
  await offlineDb.cache_period_locks.put({ id: "pl-1", return_type: "GSTR1", period: "2026-06", ...base });
  await offlineDb.cache_bom_templates.put({ id: "bom-1", output_item_id: "itm-1", name: "Widget assembly", ...base });
  await offlineDb.cache_bom_template_lines.put({ id: "bl-1", template_id: "bom-1", item_id: "itm-1", quantity: 2, company_id: COMPANY_ID });
  await offlineDb.cache_voucher_series.put({ id: "vs-1", voucher_type: "sales", prefix: "INV/", ...base });
  await offlineDb.cache_tax_templates.put({ id: "tt-1", gst_rate: 18, is_interstate: false, ...base });
  await offlineDb.cache_bill_sundries.put({ id: "bs-1", voucher_id: "v-1", sundry_type: "freight", amount: 50, ...base });
  await offlineDb.cache_transport_details.put({ voucher_id: "v-1", transporter_name: "BlueDart", ...base });
  await offlineDb.cache_cost_centres.put({ id: "cc-1", name: "Delhi Branch", is_active: true, ...base });
  await offlineDb.cache_cost_categories.put({ id: "ck-1", name: "Region", is_active: true, ...base });
}

describe("backup v2 — 100% retrieval round-trip", () => {
  beforeEach(async () => {
    await wipeCompany();
    await seed();
  });

  it("buildCompanyBackup captures every v2 collection", async () => {
    const snap = await buildCompanyBackup(COMPANY_ID);
    expect(snap.schema_version).toBe(CURRENT_BACKUP_SCHEMA);
    expect(snap.account_subgroups?.length).toBe(1);
    expect(snap.ledger_group_mappings?.length).toBe(1);
    expect(snap.account_group_overrides?.length).toBe(1);
    expect(snap.voucher_export_details?.length).toBe(1);
    expect(snap.einvoice_details?.length).toBe(1);
    expect(snap.period_locks?.length).toBe(1);
    expect(snap.bom_templates?.length).toBe(1);
    expect(snap.bom_template_lines?.length).toBe(1);
    expect(snap.voucher_series?.length).toBe(1);
    expect(snap.tax_templates?.length).toBe(1);
    expect(snap.bill_sundries?.length).toBe(1);
    expect(snap.transport_details?.length).toBe(1);
    expect(snap.cost_centres?.length).toBe(1);
    expect(snap.cost_categories?.length).toBe(1);
  });

  it("restore round-trip repopulates every v2 collection atomically", async () => {
    const snap = await buildCompanyBackup(COMPANY_ID);
    // Simulate the orphaned-profile scenario: wipe every table.
    await wipeCompany();
    // Restore.
    const summary = await restoreCompanyBackup(COMPANY_ID, snap);
    expect(summary.account_subgroups).toBe(1);
    expect(summary.ledger_group_mappings).toBe(1);
    expect(summary.account_group_overrides).toBe(1);
    expect(summary.voucher_export_details).toBe(1);
    expect(summary.einvoice_details).toBe(1);
    expect(summary.period_locks).toBe(1);
    expect(summary.bom_templates).toBe(1);
    expect(summary.bom_template_lines).toBe(1);
    expect(summary.voucher_series).toBe(1);
    expect(summary.tax_templates).toBe(1);
    expect(summary.bill_sundries).toBe(1);
    expect(summary.transport_details).toBe(1);
    expect(summary.cost_centres).toBe(1);
    expect(summary.cost_categories).toBe(1);

    // Spot-check that live IndexedDB actually has the rows back.
    const [cc, tt, bs] = await Promise.all([
      offlineDb.cache_cost_centres.where("company_id").equals(COMPANY_ID).toArray(),
      offlineDb.cache_tax_templates.where("company_id").equals(COMPANY_ID).toArray(),
      offlineDb.cache_bill_sundries.where("company_id").equals(COMPANY_ID).toArray(),
    ]);
    expect(cc.length).toBe(1);
    expect(tt.length).toBe(1);
    expect(bs.length).toBe(1);
    expect(bs[0].voucher_id).toBe("v-1");
  });

  it("v1 backups still restore without wiping v2 local tables", async () => {
    // Simulate an old backup created before v2 collections existed.
    const snap = await buildCompanyBackup(COMPANY_ID);
    const legacy = { ...snap, schema_version: 1 as const };
    delete legacy.account_subgroups;
    delete legacy.cost_centres;

    // Keep a cost centre in place so we can prove v1 restore doesn't wipe it.
    const summary = await restoreCompanyBackup(COMPANY_ID, legacy);
    // v1-only fields still populated:
    expect(summary.ledgers).toBeGreaterThan(0);
    // v2 local rows untouched (still one cost centre):
    const cc = await offlineDb.cache_cost_centres.where("company_id").equals(COMPANY_ID).toArray();
    expect(cc.length).toBe(1);
  });
});
