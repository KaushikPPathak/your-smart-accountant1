import { describe, expect, it, beforeEach } from "vitest";
import { offlineDb as db } from "@/lib/offline/db";
import { commitStatement, listLines, deleteStatement } from "@/lib/bank/local-store";
import type { ParsedBankLine } from "@/lib/bank/parse-client";

const CO = "bank-co";
const BANK = "L-bank";

const line = (date: string, debit: number, credit: number, ref = "", desc = "NEFT PAYMENT"): ParsedBankLine => ({
  txn_date: date,
  description: desc,
  reference: ref,
  debit_paise: debit,
  credit_paise: credit,
  balance_paise: null,
});

describe("Bank statement local store (used by the OCR import)", () => {
  beforeEach(async () => {
    await Promise.all([db.cache_bank_statements.clear(), db.cache_bank_statement_lines.clear()]);
  });

  it("saves the statement and its lines locally and reads them back", async () => {
    const res = await commitStatement(CO, BANK, "scan.pdf", [
      line("2026-04-03", 150000, 0, "UTR1"),
      line("2026-04-05", 0, 90000, "UTR2"),
    ], []);

    expect(res.unmatched).toBe(2);
    const stmts = await db.cache_bank_statements.where("company_id").equals(CO).toArray();
    expect(stmts).toHaveLength(1);
    expect(stmts[0].file_name).toBe("scan.pdf");
    expect(stmts[0].from_date).toBe("2026-04-03");
    expect(stmts[0].to_date).toBe("2026-04-05");

    const rows = await listLines(CO, BANK);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.reference).sort()).toEqual(["UTR1", "UTR2"]);
  });

  it("suggests a matching voucher for an equal amount within 7 days", async () => {
    const res = await commitStatement(CO, BANK, "a.csv", [line("2026-04-03", 150000, 0, "UTR9")], [
      { id: "V-pay", voucher_date: "2026-04-02", voucher_number: "P-1", reference_no: "UTR9", total_paise: 150000, voucher_type: "payment" },
    ]);
    expect(res.matched).toBe(1);
    const [row] = await listLines(CO, BANK);
    expect(row.match_status).toBe("suggested");
    expect(row.matched_voucher_id).toBe("V-pay");
  });

  it("deleting a statement removes its lines too", async () => {
    const res = await commitStatement(CO, BANK, "a.csv", [line("2026-04-03", 100, 0)], []);
    await deleteStatement(res.statementId);
    expect(await listLines(CO, BANK)).toHaveLength(0);
    expect(await db.cache_bank_statements.count()).toBe(0);
  });

  it("lines of one bank ledger do not show under another", async () => {
    await commitStatement(CO, BANK, "a.csv", [line("2026-04-03", 100, 0)], []);
    expect(await listLines(CO, "L-other")).toHaveLength(0);
  });
});
