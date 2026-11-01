// Manufacturing journal for the local-only build. Writes the voucher, its
// consumed and produced item lines, and the ledger entries to this PC's books.
import { offlineDb as db } from "@/lib/offline/db";
import { emitDataChange } from "@/lib/ai/cache-events";
import { newId } from "@/lib/utils/sys-utils";
import { rupeesToPaise } from "@/lib/money";
import { assertDateInOpenFy, nextLocalVoucherNumber } from "@/lib/offline/voucher-executors";

export interface ManufacturingLineInput {
  item_id: string;
  qty: string;
  rate: string;
  attrs: { k: string; v: string }[];
  is_byproduct?: boolean;
}

export interface ManufacturingSnapInput {
  companyId: string;
  date: string;
  department: string;
  productionOrderNo: string;
  composedNarration: string;
  consume: ManufacturingLineInput[];
  outputs: ManufacturingLineInput[];
  totalConsumePaise: number;
  processingPaise: number;
  scrapPaise: number;
  headerMeta: Record<string, string>;
}

const attrsToObj = (a: { k: string; v: string }[]): Record<string, string> => {
  const o: Record<string, string> = {};
  a.forEach((kv) => {
    const k = kv.k.trim();
    if (k) o[k] = kv.v;
  });
  return o;
};

async function ensureLedgerLocal(
  companyId: string,
  name: string,
  type: string,
  groupCode: string,
): Promise<string> {
  const wanted = name.toLowerCase();
  const existing: any = (await db.cache_ledgers.where("company_id").equals(companyId).toArray())
    .find((l: any) => String(l.name ?? "").toLowerCase() === wanted && l.is_active !== false);
  if (existing) return String(existing.id);
  const id = newId();
  await db.cache_ledgers.put({
    id,
    company_id: companyId,
    name,
    type,
    group_code: groupCode,
    opening_balance_paise: 0,
    opening_balance_is_debit: true,
    is_active: true,
    updated_at: new Date().toISOString(),
  });
  return id;
}

export async function saveManufacturingLocal(snap: ManufacturingSnapInput): Promise<{ voucherId: string; voucherNumber: string }> {
  await assertDateInOpenFy(snap.companyId, snap.date);
  const voucherNumber = await nextLocalVoucherNumber(snap.companyId, "manufacturing", snap.date);
  const voucherId = newId();
  const now = new Date().toISOString();
  const totalCostTransfer = snap.totalConsumePaise + snap.processingPaise - snap.scrapPaise;

  await db.transaction(
    "rw",
    [db.cache_vouchers, db.cache_voucher_items, db.cache_voucher_entries, db.cache_ledgers],
    async () => {
      await db.cache_vouchers.put({
        id: voucherId,
        company_id: snap.companyId,
        voucher_type: "manufacturing",
        voucher_number: voucherNumber,
        voucher_date: snap.date,
        reference_no: snap.productionOrderNo || snap.department || null,
        narration: snap.composedNarration || null,
        subtotal_paise: snap.totalConsumePaise,
        total_paise: Math.max(0, totalCostTransfer),
        is_deleted: false,
        is_synced: true,
        created_at: now,
        updated_at: now,
      });

      const itemRow = (r: ManufacturingLineInput, lineNo: number, sign: 1 | -1, flow: string) => {
        const qty = parseFloat(r.qty) || 0;
        const ratePaise = rupeesToPaise(parseFloat(r.rate) || 0);
        return {
          id: newId(),
          voucher_id: voucherId,
          company_id: snap.companyId,
          item_id: r.item_id,
          line_no: lineNo,
          qty: sign * qty,
          rate_paise: ratePaise,
          amount_paise: sign * Math.round(qty * ratePaise),
          taxable_paise: 0,
          gst_rate: 0,
          specs: { ...attrsToObj(r.attrs), ...snap.headerMeta, flow },
        };
      };
      const itemRows = [
        ...snap.consume.map((r, i) => itemRow(r, i + 1, -1, "input")),
        ...snap.outputs.map((r, i) => itemRow(r, snap.consume.length + i + 1, 1, r.is_byproduct ? "byproduct" : "output")),
      ];
      await db.cache_voucher_items.bulkPut(itemRows);

      if (totalCostTransfer > 0) {
        const fgId = await ensureLedgerLocal(snap.companyId, "Finished Goods", "stock_in_hand", "STOCK_IN_HAND");
        const rmId = await ensureLedgerLocal(snap.companyId, "Raw Materials", "stock_in_hand", "STOCK_IN_HAND");
        const entries: Array<Record<string, unknown>> = [
          { ledger_id: fgId, line_no: 1, debit_paise: totalCostTransfer, credit_paise: 0, narration: "Finished goods produced (incl. overhead, net of scrap)" },
          { ledger_id: rmId, line_no: 2, debit_paise: 0, credit_paise: snap.totalConsumePaise, narration: "Raw materials consumed" },
        ];
        if (snap.processingPaise > 0) {
          const id = await ensureLedgerLocal(snap.companyId, "Processing Overhead Absorbed", "expense_direct", "DIRECT_EXPENSES");
          entries.push({ ledger_id: id, line_no: 3, debit_paise: 0, credit_paise: snap.processingPaise, narration: "Processing overhead absorbed into production" });
        }
        if (snap.scrapPaise > 0) {
          const id = await ensureLedgerLocal(snap.companyId, "Scrap / Byproduct Recovery", "income_indirect", "INDIRECT_INCOMES");
          entries.push({ ledger_id: id, line_no: 4, debit_paise: snap.scrapPaise, credit_paise: 0, narration: "Scrap value recovered (reduces FG cost)" });
        }
        await db.cache_voucher_entries.bulkPut(
          entries.map((e) => ({ id: newId(), voucher_id: voucherId, company_id: snap.companyId, ...e })),
        );
      }
    },
  );
  emitDataChange(snap.companyId, "voucher");
  emitDataChange(snap.companyId, "ledger");
  return { voucherId, voucherNumber };
}
