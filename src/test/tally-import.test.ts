import "fake-indexeddb/auto";
import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  parseTallyDate, parseVoucherNumber, parseDspText,
} from "@/lib/tally/dsp-ledger-xml";
import {
  parseFileOrZip, classifyAndMap, postLedgers, postVouchers,
  type VoucherRecord,
} from "@/lib/tally-busy-import";
import { getDbInstance } from "@/lib/utils/sys-utils";

const SAMPLE = `<ENVELOPE>
 <LVACCTITLE>RAMESH TRADERS</LVACCTITLE>
 <LEDGRPADDRESS>1 MAIN ROAD, SURAT</LEDGRPADDRESS>
 <DSPVCHDATE>1-Apr-25</DSPVCHDATE>
 <DSPVCHLEDACCOUNT>Opening Balance</DSPVCHLEDACCOUNT>
 <DSPVCHDRAMT>-10000.00</DSPVCHDRAMT>
 <DSPVCHCRAMT></DSPVCHCRAMT>
 <DSPVCHDATE>14-Apr-25</DSPVCHDATE>
 <DSPVCHLEDACCOUNT>SALES GST</DSPVCHLEDACCOUNT>
 <DSPVCHTYPE>Sale</DSPVCHTYPE>
 <DSPVCHDRAMT>-5000.00</DSPVCHDRAMT>
 <DSPVCHCRAMT></DSPVCHCRAMT>
 <DSPEXPLVCHNUMBER>(No. :55/25-26)</DSPEXPLVCHNUMBER>
 <DSPVCHDATE>22-Apr-25</DSPVCHDATE>
 <DSPVCHLEDACCOUNT>KOTAK MAHINDRA BANK</DSPVCHLEDACCOUNT>
 <DSPVCHTYPE>Rcpt</DSPVCHTYPE>
 <DSPVCHDRAMT></DSPVCHDRAMT>
 <DSPVCHCRAMT>3000.00</DSPVCHCRAMT>
 <DSPEXPLVCHNUMBER>(No. :34)</DSPEXPLVCHNUMBER>
 <DSPVCHDATETITLE></DSPVCHDATETITLE>
 <DSPVCHACCTTITLE>Closing Balance</DSPVCHACCTTITLE>
 <LVSUBDRTOTAL>-15000.00</LVSUBDRTOTAL>
 <LVSUBCRTOTAL>3000.00</LVSUBCRTOTAL>
 <LVSUBDRTOTAL>-12000.00</LVSUBDRTOTAL>
 <LVSUBCRTOTAL>-12000.00</LVSUBCRTOTAL>
</ENVELOPE>
<LVACCTITLE>KOTAK MAHINDRA BANK</LVACCTITLE>
 <DSPVCHDATE>22-Apr-25</DSPVCHDATE>
 <DSPVCHLEDACCOUNT>RAMESH TRADERS</DSPVCHLEDACCOUNT>
 <DSPVCHTYPE>Rcpt</DSPVCHTYPE>
 <DSPVCHDRAMT>-3000.00</DSPVCHDRAMT>
 <DSPVCHCRAMT></DSPVCHCRAMT>
 <DSPEXPLVCHNUMBER>(No. :34)</DSPEXPLVCHNUMBER>
`;

const REAL = "/mnt/user-data/attachments/4af5466a-9a43-5d0e-a015-0ec38d39e385/6fd9502a-Transactions_ALL_LEDGER.xml";

describe("Tally ledger-statement parsing", () => {
  it("reads dates and voucher numbers", () => {
    expect(parseTallyDate("1-Apr-25")).toBe("2025-04-01");
    expect(parseTallyDate("26-Mar-26")).toBe("2026-03-26");
    expect(parseTallyDate("nonsense")).toBe("");
    expect(parseVoucherNumber("(No. :55/25-26)")).toBe("55/25-26");
    expect(parseVoucherNumber("(No. :16)")).toBe("16");
  });

  it("reads opening balance and signed entries", () => {
    const blocks = parseDspText(SAMPLE);
    expect(blocks.map((b) => b.ledger)).toEqual(["RAMESH TRADERS", "KOTAK MAHINDRA BANK"]);
    expect(blocks[0].opening).toBe(-10000);
    expect(blocks[0].entries).toHaveLength(2);
    expect(blocks[0].entries[0]).toMatchObject({ counter: "SALES GST", type: "Sale", number: "55/25-26", amount: -5000 });
    expect(blocks[0].entries[1]).toMatchObject({ counter: "KOTAK MAHINDRA BANK", amount: 3000 });
  });
});

describe("Tally import into local cache", () => {
  beforeEach(async () => {
    const db = await getDbInstance();
    await db.cache_ledgers.clear();
    await db.cache_vouchers.clear();
    await db.cache_voucher_entries.clear();
  });

  it("rejects non-Tally XML and non-XML files", async () => {
    await expect(parseFileOrZip(new File(["<a/>"], "x.xml"))).rejects.toThrow(/not a Tally ledger statement/);
    await expect(parseFileOrZip(new File(["a,b"], "x.csv"))).rejects.toThrow(/Only Tally XML/);
  });

  it("de-duplicates a voucher listed in two statements and keeps it balanced", async () => {
    const rows = await parseFileOrZip(new File([SAMPLE], "sample.xml"));
    expect(rows).toHaveLength(2);
    const out = await classifyAndMap(rows);
    expect(out.vouchers).toHaveLength(2);
    for (const v of out.vouchers as VoucherRecord[]) {
      const dr = v.entries!.reduce((s, e) => s + e.debit, 0);
      const cr = v.entries!.reduce((s, e) => s + e.credit, 0);
      expect(dr).toBeCloseTo(cr, 2);
    }
    const names = out.ledgers.map((l) => l.name).sort();
    expect(names).toEqual(["KOTAK MAHINDRA BANK", "RAMESH TRADERS", "SALES GST"]);
    const ramesh = out.ledgers.find((l) => l.name === "RAMESH TRADERS")!;
    expect(ramesh.opening).toBe(10000); // debit opening balance
  });

  it("writes ledgers and vouchers, then skips them on a second import", async () => {
    const rows = await parseFileOrZip(new File([SAMPLE], "sample.xml"));
    const out = await classifyAndMap(rows);
    const companyId = "test-company";
    const l1 = await postLedgers(companyId, out.ledgers);
    expect(l1.created).toBe(3);
    const v1 = await postVouchers(companyId, out.vouchers);
    expect(v1.created).toBe(2);
    expect(v1.failed).toEqual([]);

    const db = await getDbInstance();
    expect(await db.cache_vouchers.count()).toBe(2);
    expect(await db.cache_voucher_entries.count()).toBe(4);

    const v2 = await postVouchers(companyId, out.vouchers);
    expect(v2.created).toBe(0);
    expect(v2.skipped).toBe(2);
    const l2 = await postLedgers(companyId, out.ledgers);
    expect(l2.skipped).toBe(3);
  });
});

describe.skipIf(!existsSync(REAL))("Full Tally ledger export (Transactions_ALL_LEDGER.xml)", () => {
  it("imports every statement, balances every voucher and matches a printed closing balance", async () => {
    const file = new File([readFileSync(REAL)], "Transactions_ALL_LEDGER.xml");
    const rows = await parseFileOrZip(file);
    expect(rows.length).toBeGreaterThan(600);
    const out = await classifyAndMap(rows);
    expect(out.vouchers.length).toBeGreaterThan(5000);

    let dr = 0;
    let cr = 0;
    for (const v of out.vouchers as VoucherRecord[]) {
      const d = v.entries!.reduce((s, e) => s + e.debit, 0);
      const c = v.entries!.reduce((s, e) => s + e.credit, 0);
      expect(d).toBeCloseTo(c, 2);
      dr += d;
      cr += c;
    }
    expect(dr).toBeCloseTo(cr, 2);

    // AALIDHRA INDUSTRIES PRIVATE LIMITED closes at 1,39,284.40 Dr in the file.
    const aalidhra = out.ledgers.find((l) => l.name === "AALIDHRA INDUSTRIES PRIVATE LIMITED")!;
    let closing = aalidhra.opening ?? 0;
    for (const v of out.vouchers as VoucherRecord[]) {
      for (const e of v.entries!) {
        if (e.ledger === aalidhra.name) closing += e.debit - e.credit;
      }
    }
    expect(closing).toBeCloseTo(139284.4, 2);

    const companyId = "real-company";
    await postLedgers(companyId, out.ledgers);
    const posted = await postVouchers(companyId, out.vouchers);
    expect(posted.failed).toEqual([]);
    const again = await postVouchers(companyId, out.vouchers);
    expect(again.created).toBe(0);
    expect(again.skipped).toBe(posted.created);
    let suspenseNet = 0;
    let suspenseAbs = 0;
    for (const v of out.vouchers as VoucherRecord[]) {
      for (const e of v.entries!) {
        if (e.ledger === "TALLY UNMATCHED ENTRIES") { suspenseNet += e.debit - e.credit; suspenseAbs += e.debit + e.credit; }
      }
    }
    console.log(`REAL FILE: statements=${rows.length} ledgers=${out.ledgers.length} vouchers=${out.vouchers.length} one_sided=${out.unknown} suspense_net=${suspenseNet.toFixed(2)} suspense_gross=${(suspenseAbs / 2).toFixed(2)} created=${posted.created} repeat_skipped=${again.skipped}`);
  }, 120000);
});
