import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import { parseOpeningBalance } from "@/lib/tally/master-xml";
import {
  parseFileOrZip, classifyAndMap, postLedgers, postItems, type LedgerRecord,
} from "@/lib/tally-busy-import";
import { getDbInstance } from "@/lib/utils/sys-utils";

const MASTERS = `<ENVELOPE><HEADER><VERSION>1</VERSION></HEADER><BODY><IMPORTDATA><REQUESTDATA>
<TALLYMESSAGE xmlns:UDF="TallyUDF">
<GROUP NAME="BHAVIN GROUP" RESERVEDNAME=""><NAME>BHAVIN GROUP</NAME><PARENT>Sundry Debtors</PARENT></GROUP>
<LEDGER NAME="ABHISHEK TEXTILES" RESERVEDNAME=""><NAME>ABHISHEK TEXTILES</NAME><PARENT>Sundry Debtors</PARENT><OPENINGBALANCE>-3350.00</OPENINGBALANCE><PARTYGSTIN>24AAAAA0000A1Z5</PARTYGSTIN></LEDGER>
<LEDGER NAME="SUB PARTY" RESERVEDNAME=""><NAME>SUB PARTY</NAME><PARENT>BHAVIN GROUP</PARENT></LEDGER>
<LEDGER NAME="ACCOUNT FEES PAYABLE"><LANGUAGENAME.LIST><NAME.LIST TYPE="String"><NAME>ACCOUNT FEES PAYABLE</NAME></NAME.LIST></LANGUAGENAME.LIST><PARENT>Sundry Creditors</PARENT><OPENINGBALANCE>20000.00</OPENINGBALANCE></LEDGER>
<LEDGER NAME="Cash"><PARENT>Cash-in-hand</PARENT><OPENINGBALANCE>-27534.00</OPENINGBALANCE></LEDGER>
<STOCKITEM NAME="TORQ 180 KG" RESERVEDNAME=""><NAME>TORQ 180 KG</NAME><PARENT>Lubricants</PARENT><BASEUNITS>Kgs</BASEUNITS><GSTDETAILS.LIST><HSNCODE>271019</HSNCODE><RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST></GSTDETAILS.LIST><OPENINGBALANCE>10 Kgs</OPENINGBALANCE><OPENINGRATE>300.00/Kgs</OPENINGRATE><OPENINGVALUE>3000.00</OPENINGVALUE></STOCKITEM>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

describe("Tally master XML", () => {
  beforeEach(async () => {
    const db = await getDbInstance();
    for (const t of ["cache_ledgers", "cache_items"]) await (db as any)[t].clear();
  });

  it("reads a masters-only file without vouchers", async () => {
    const rows = await parseFileOrZip(new File([MASTERS], "masters.xml"));
    expect(rows.filter((r) => r.kind === "tally_master_ledger")).toHaveLength(4);
    expect(rows.filter((r) => r.kind === "tally_master_item")).toHaveLength(1);
  });

  it("sets groups through custom groups, opening balances (Dr positive in the app) and GSTIN", async () => {
    const out = await classifyAndMap(await parseFileOrZip(new File([MASTERS], "masters.xml")));
    const by = (n: string) => out.ledgers.find((l) => l.name === n)!;
    expect(by("ABHISHEK TEXTILES")).toMatchObject({ group_code: "SUNDRY_DEBTORS", opening: 3350, gstin: "24AAAAA0000A1Z5", source: "master" });
    expect(by("SUB PARTY").group_code).toBe("SUNDRY_DEBTORS");
    expect(by("ACCOUNT FEES PAYABLE")).toMatchObject({ group_code: "SUNDRY_CREDITORS", opening: -20000 });
    expect(by("Cash")).toMatchObject({ group_code: "CASH_IN_HAND", opening: 27534 });
    expect(parseOpeningBalance("7316.00 Dr")).toBe(-7316);
    expect(parseOpeningBalance("7316.00 Cr")).toBe(7316);
  });

  it("reads item unit, HSN, GST rate and opening stock", async () => {
    const out = await classifyAndMap(await parseFileOrZip(new File([MASTERS], "masters.xml")));
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ name: "TORQ 180 KG", unit: "Kgs", hsn: "271019", gst_rate: 18, opening_qty: 10, opening_rate: 300 });
  });

  it("fills existing ledgers and items from the master without duplicating them", async () => {
    const company = "co-master";
    const db = await getDbInstance();
    // An existing ledger from an earlier statement import: wrong group, no opening, no GSTIN.
    await postLedgers(company, [{ name: "Cash", type: "cash", group_code: "CURRENT_ASSETS", group: "CURRENT_ASSETS", opening: 0 } as LedgerRecord]);
    const out = await classifyAndMap(await parseFileOrZip(new File([MASTERS], "masters.xml")));
    const res = await postLedgers(company, out.ledgers);
    expect(res.updated).toBe(1);   // Cash already existed and is filled in
    expect(res.created).toBe(3);   // the other three ledgers are new
    const cash = (await db.cache_ledgers.where("company_id").equals(company).toArray()).find((l: any) => l.name === "Cash");
    expect(cash).toMatchObject({ group_code: "CASH_IN_HAND", opening_balance_paise: 2753400, opening_balance_is_debit: true });
    const abhishek = (await db.cache_ledgers.where("company_id").equals(company).toArray()).find((l: any) => l.name === "ABHISHEK TEXTILES");
    expect(abhishek.gstin).toBe("24AAAAA0000A1Z5");

    const items = await postItems(company, out.items);
    expect(items.created).toBe(1);
    const again = await postItems(company, out.items);
    expect(again.created).toBe(0);
    expect(again.updated).toBe(1);
    const item = (await db.cache_items.where("company_id").equals(company).toArray())[0];
    expect(item).toMatchObject({ unit: "Kgs", hsn_code: "271019", gst_rate: 18, opening_stock_qty: 10, opening_stock_rate_paise: 30000 });
  });
});
