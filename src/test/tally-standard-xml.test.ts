import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  parseStandardVoucher, parseQuantity, parseRate, parseCompactDate, parseStandardVouchers,
} from "@/lib/tally/standard-voucher-xml";
import { decodeXmlText, stripInvalidXmlChars, encodingFromBom } from "@/lib/tally/xml-text";
import {
  parseFileOrZip, classifyAndMap, postLedgers, postVouchers, postItems, mapTallyVoucherType,
  createImportBatch, finalizeImportBatch, listImportBatches, deleteImportBatch,
  type VoucherRecord,
} from "@/lib/tally-busy-import";
import { getDbInstance } from "@/lib/utils/sys-utils";
import { invalidatePeriodLockCache } from "@/lib/offline/frozen-guard";

const SAMPLE_SALE = `<ENVELOPE><HEADER><VERSION>1</VERSION></HEADER><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="SALES GST" ACTION="Create">
 <DATE>20260401</DATE>
 <VOUCHERTYPENAME>SALES GST</VOUCHERTYPENAME>
 <PARTYLEDGERNAME>NEELA SILK</PARTYLEDGERNAME>
 <VOUCHERNUMBER>1/26-27</VOUCHERNUMBER>
 <ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>TORQ 180 KG</STOCKITEMNAME>
  <RATE>315.44/Kgs</RATE>
  <AMOUNT>56779.20</AMOUNT>
  <ACTUALQTY> 180.00 Kgs =  1 PCS</ACTUALQTY>
  <BILLEDQTY> 180.00 Kgs =  1 PCS</BILLEDQTY>
  <GSTHSNNAME>271019</GSTHSNNAME>
  <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE> 9</GSTRATE></RATEDETAILS.LIST>
  <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATE> 9</GSTRATE></RATEDETAILS.LIST>
  <ACCOUNTINGALLOCATIONS.LIST>
   <LEDGERNAME>SALES GST</LEDGERNAME>
   <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
   <AMOUNT>56779.20</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
 </ALLINVENTORYENTRIES.LIST>
 <LEDGERENTRIES.LIST>
  <LEDGERNAME>NEELA SILK</LEDGERNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <AMOUNT>-67000.00</AMOUNT>
 </LEDGERENTRIES.LIST>
 <LEDGERENTRIES.LIST>
  <LEDGERNAME>OUTPUT SGST@ 9%</LEDGERNAME>
  <AMOUNT>5110.13</AMOUNT>
 </LEDGERENTRIES.LIST>
 <LEDGERENTRIES.LIST>
  <LEDGERNAME>OUTPUT CGST@9%</LEDGERNAME>
  <AMOUNT>5110.13</AMOUNT>
 </LEDGERENTRIES.LIST>
 <LEDGERENTRIES.LIST>
  <LEDGERNAME>OUTPUT ROUND OFF</LEDGERNAME>
  <AMOUNT>0.54</AMOUNT>
 </LEDGERENTRIES.LIST>
</VOUCHER>
<VOUCHER VCHTYPE="Receipt" ACTION="Create">
 <DATE>20260405</DATE>
 <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
 <VOUCHERNUMBER>2</VOUCHERNUMBER>
 <ALLLEDGERENTRIES.LIST><LEDGERNAME>KOTAK BANK</LEDGERNAME><AMOUNT>3000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 <ALLLEDGERENTRIES.LIST><LEDGERNAME>NEELA SILK</LEDGERNAME><AMOUNT>-3000.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>
<VOUCHER VCHTYPE="Payment" ACTION="Create">
 <DATE>20260406</DATE>
 <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
 <VOUCHERNUMBER>3</VOUCHERNUMBER>
 <ISCANCELLED>Yes</ISCANCELLED>
 <ALLLEDGERENTRIES.LIST><LEDGERNAME>KOTAK BANK</LEDGERNAME><AMOUNT>-500.00</AMOUNT></ALLLEDGERENTRIES.LIST>
 <ALLLEDGERENTRIES.LIST><LEDGERNAME>RENT</LEDGERNAME><AMOUNT>500.00</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

const REAL_DAYBOOK = "/mnt/user-data/attachments/4af5466a-9a43-5d0e-a015-0ec38d39e385/cabf2c64-DayBook.xml";
const REAL_TRANSACTIONS = "/mnt/user-data/attachments/4af5466a-9a43-5d0e-a015-0ec38d39e385/341f8f14-Transactions.xml";

describe("Tally standard voucher parsing", () => {
  it("reads date, number, party, type and both sides of a sale", () => {
    const v = parseStandardVoucher(SAMPLE_SALE.slice(SAMPLE_SALE.indexOf("<VOUCHER "), SAMPLE_SALE.indexOf("</VOUCHER>") + 10))!;
    expect(v.date).toBe("2026-04-01");
    expect(v.number).toBe("1/26-27");
    expect(v.party).toBe("NEELA SILK");
    expect(v.vch_type).toBe("SALES GST");
    expect(v.active).toBe(true);
    // Party line plus the sales allocation plus tax and round-off lines.
    expect(v.lines.map((l) => l.ledger)).toEqual([
      "SALES GST", "NEELA SILK", "OUTPUT SGST@ 9%", "OUTPUT CGST@9%", "OUTPUT ROUND OFF",
    ]);
    const sum = v.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.abs(sum)).toBeLessThan(0.005); // sales credit comes from the stock allocation
  });

  it("reads stock line quantity, rate, HSN and GST rate", () => {
    const v = parseStandardVoucher(SAMPLE_SALE.slice(SAMPLE_SALE.indexOf("<VOUCHER "), SAMPLE_SALE.indexOf("</VOUCHER>") + 10))!;
    expect(v.items).toHaveLength(1);
    expect(v.items[0]).toMatchObject({ name: "TORQ 180 KG", qty: 180, unit: "Kgs", rate: 315.44, rate_unit: "Kgs", hsn: "271019", gst_rate: 18 });
  });

  it("marks cancelled vouchers as inactive", () => {
    const xml = SAMPLE_SALE.slice(SAMPLE_SALE.indexOf("<VOUCHER VCHTYPE=\"Payment\""), SAMPLE_SALE.lastIndexOf("</VOUCHER>") + 10);
    const v = parseStandardVoucher(xml)!;
    expect(v.active).toBe(false);
  });

  it("parses quantities, rates and compact dates", () => {
    expect(parseQuantity(" 540.00 Kgs")).toEqual({ qty: 540, unit: "Kgs" });
    expect(parseQuantity(" 1260.00 Ltr")).toEqual({ qty: 1260, unit: "Ltr" });
    expect(parseRate("120.00/Ltr")).toEqual({ rate: 120, rate_unit: "Ltr" });
    expect(parseRate("305")).toEqual({ rate: 305, rate_unit: undefined });
    expect(parseCompactDate("20260331")).toBe("2026-03-31");
    expect(parseCompactDate("31-Mar-26")).toBe("");
  });

  it("streams vouchers from chunks that split tags in the middle", async () => {
    const text = SAMPLE_SALE;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += 37) chunks.push(text.slice(i, i + 37));
    async function* gen() { for (const c of chunks) yield c; }
    const seen: string[] = [];
    const count = await parseStandardVouchers(gen(), (v) => seen.push(v.number));
    expect(count).toBe(3);
    expect(seen).toEqual(["1/26-27", "2", "3"]);
  });
});

describe("Tally XML text handling", () => {
  it("drops references and characters that XML forbids, keeps valid ones", () => {
    expect(decodeXmlText("A&#4;B&amp;C&#x41;&lt;")).toBe("AB&CA<");
    expect(stripInvalidXmlChars("X\u0005Y\u0000Z")).toBe("XYZ");
  });

  it("detects UTF-16 byte-order marks", () => {
    expect(encodingFromBom(new Uint8Array([0xff, 0xfe]))).toBe("utf-16le");
    expect(encodingFromBom(new Uint8Array([0xfe, 0xff]))).toBe("utf-16be");
    expect(encodingFromBom(new Uint8Array([0x3c, 0x3f]))).toBe("utf-8");
  });

  it("maps Tally type names that carry a tax suffix", () => {
    expect(mapTallyVoucherType("SALES GST")).toBe("sales");
    expect(mapTallyVoucherType("PURCHASE GST")).toBe("purchase");
    expect(mapTallyVoucherType("Receipt")).toBe("receipt");
    expect(mapTallyVoucherType("Credit Note")).toBe("credit_note");
    expect(mapTallyVoucherType("Debit Note")).toBe("debit_note");
  });
});

describe("Tally standard XML import into local cache", () => {
  beforeEach(async () => {
    const db = await getDbInstance();
    await db.cache_ledgers.clear();
    await db.cache_vouchers.clear();
    await db.cache_voucher_entries.clear();
  });

  it("imports balanced vouchers, skips the cancelled one, and skips duplicates on a second import", async () => {
    const rows = await parseFileOrZip(new File([SAMPLE_SALE], "daybook.xml"));
    expect(rows).toHaveLength(3);
    const out = await classifyAndMap(rows);
    expect(out.cancelled).toBe(1);
    expect(out.vouchers).toHaveLength(2);
    expect(out.unknown).toBe(0);
    const names = out.ledgers.map((l) => l.name).sort();
    expect(names).toEqual(["KOTAK BANK", "NEELA SILK", "OUTPUT CGST@9%", "OUTPUT ROUND OFF", "OUTPUT SGST@ 9%", "SALES GST"]);

    await postLedgers("co-std", out.ledgers);
    const first = await postVouchers("co-std", out.vouchers as VoucherRecord[]);
    expect(first.created).toBe(2);
    expect(first.failed).toEqual([]);

    const again = await postVouchers("co-std", out.vouchers as VoucherRecord[]);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(2);
  });
});

describe.skipIf(!existsSync(REAL_DAYBOOK))("Real Day Book export (cabf2c64-DayBook.xml)", () => {
  it("reads 18 vouchers and every voucher balances", async () => {
    const file = new File([readFileSync(REAL_DAYBOOK)], "DayBook.xml");
    const rows = await parseFileOrZip(file);
    expect(rows).toHaveLength(18);
    const out = await classifyAndMap(rows);
    expect(out.vouchers).toHaveLength(18);
    expect(out.unknown).toBe(0);
    for (const v of out.vouchers as VoucherRecord[]) {
      const dr = v.entries!.reduce((s, e) => s + e.debit, 0);
      const cr = v.entries!.reduce((s, e) => s + e.credit, 0);
      expect(Math.abs(dr - cr)).toBeLessThan(0.005);
    }
    expect(out.items.length).toBeGreaterThan(0);
  });
});

describe.skipIf(!existsSync(REAL_TRANSACTIONS))("Real Transactions export (341f8f14-Transactions.xml, UTF-16)", () => {
  it("reads every voucher from the UTF-16 file and every voucher balances", async () => {
    const file = new File([readFileSync(REAL_TRANSACTIONS)], "Transactions.xml");
    const rows = await parseFileOrZip(file);
    expect(rows.length).toBeGreaterThanOrEqual(222);
    const out = await classifyAndMap(rows);
    expect(out.unknown).toBe(0);
    let bad = 0;
    for (const v of out.vouchers as VoucherRecord[]) {
      const dr = v.entries!.reduce((s, e) => s + e.debit, 0);
      const cr = v.entries!.reduce((s, e) => s + e.credit, 0);
      if (Math.abs(dr - cr) > 0.005) bad++;
    }
    expect(bad).toBe(0);
    expect(out.items.length).toBeGreaterThan(0);
  }, 120000);
});

describe("Tally stock items and import history", () => {
  beforeEach(async () => {
    const db = await getDbInstance();
    await db.cache_ledgers.clear();
    await db.cache_items.clear();
    await db.cache_vouchers.clear();
    await db.cache_voucher_entries.clear();
    await db.cache_import_batches.clear();
  });

  it("creates stock items with HSN, GST rate and sale or purchase rate", async () => {
    const rows = await parseFileOrZip(new File([SAMPLE_SALE], "daybook.xml"));
    const out = await classifyAndMap(rows);
    expect(out.items).toHaveLength(1);
    const res = await postItems("co-items", out.items);
    expect(res.created).toBe(1);
    const db = await getDbInstance();
    const item = (await db.cache_items.where("company_id").equals("co-items").toArray())[0];
    expect(item).toMatchObject({ name: "TORQ 180 KG", unit: "Kgs", hsn_code: "271019", gst_rate: 18, sale_price_paise: 31544, purchase_price_paise: 0 });
    const again = await postItems("co-items", out.items);
    expect(again.skipped).toBe(1);
  });

  it("records an import, lists it, undoes it completely, and allows a clean re-import", async () => {
    const company = "co-history";
    const rows = await parseFileOrZip(new File([SAMPLE_SALE], "daybook.xml"));
    const out = await classifyAndMap(rows);

    const batchId = await createImportBatch(company, { source: "tally_xml", label: "Day book", fileName: "daybook.xml" });
    const l = await postLedgers(company, out.ledgers, undefined, batchId);
    const i = await postItems(company, out.items, undefined, batchId);
    const v = await postVouchers(company, out.vouchers as VoucherRecord[], undefined, batchId);
    await finalizeImportBatch(batchId, { ledgers: l.created, items: i.created, vouchers: v.created });

    const history = await listImportBatches(company);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: batchId, status: "done", label: "Day book", file_name: "daybook.xml", vouchers_created: 2, items_created: 1 });

    const db = await getDbInstance();
    expect(await db.cache_vouchers.count()).toBe(2);

    const undo = await deleteImportBatch(batchId);
    expect(undo.vouchers).toBe(2);
    expect(undo.items).toBe(1);
    expect(undo.ledgers).toBe(out.ledgers.length);
    expect(await db.cache_vouchers.count()).toBe(0);
    expect(await db.cache_voucher_entries.count()).toBe(0);
    expect(await db.cache_ledgers.count()).toBe(0);
    expect(await db.cache_items.count()).toBe(0);
    expect((await listImportBatches(company))[0].status).toBe("undone");
    await expect(deleteImportBatch(batchId)).rejects.toThrow(/already been undone/);

    // After an undo the same file imports again, with nothing skipped as duplicate.
    const batch2 = await createImportBatch(company, { source: "tally_xml" });
    await postLedgers(company, out.ledgers, undefined, batch2);
    const v2 = await postVouchers(company, out.vouchers as VoucherRecord[], undefined, batch2);
    expect(v2.created).toBe(2);
    expect(v2.skipped).toBe(0);
  });

  it("refuses to undo when a voucher is in a locked period, and removes nothing", async () => {
    const company = "co-locked";
    const rows = await parseFileOrZip(new File([SAMPLE_SALE], "daybook.xml"));
    const out = await classifyAndMap(rows);
    const batchId = await createImportBatch(company, { source: "tally_xml" });
    await postLedgers(company, out.ledgers, undefined, batchId);
    await postVouchers(company, out.vouchers as VoucherRecord[], undefined, batchId);

    const db = await getDbInstance();
    await db.table("cache_period_locks").put({ id: "lock-1", company_id: company, period_start: "2026-04-01", period_end: "2026-04-30", is_active: true, return_type: "GSTR1", period: "2026-04", updated_at: "2026-05-01T00:00:00.000Z" });
    invalidatePeriodLockCache();
    await expect(deleteImportBatch(batchId)).rejects.toThrow(/locked period/);
    expect(await db.cache_vouchers.count()).toBe(2);
    expect((await listImportBatches(company))[0].status).toBe("running");
  });
});
