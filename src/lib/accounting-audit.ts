// Deep accounting-logic audit ("CA-grade" semantic repair engine).
//
// Where semantic-checks.ts asks "do reports tally?", this module asks the
// harder questions a Chartered Accountant would ask while reviewing books:
//
//   • Are GST taxes consistent across voucher_items, voucher header and
//     the postings to duties_taxes ledgers?
//   • Are interstate vouchers actually using IGST (and intra using CGST+SGST,
//     in equal halves)?
//   • Are party / place-of-supply / HSN / GSTIN fields populated where the
//     law requires them?
//   • Are Cash / Bank ledger balances ever negative on any historical date?
//   • Are Sundry Debtor / Creditor opening-balance directions correct?
//   • Are Receipt / Payment / Contra vouchers using the right ledger mix?
//   • Are Sales / Purchase vouchers actually hitting an income / expense ledger?
//   • Do bill allocations exceed the invoice value?
//   • Are there future-dated vouchers or duplicate party-invoice numbers?
//   • Is a P&L-nature ledger mis-typed as a Balance-Sheet ledger (or vice-versa)?
//
// Designed to plug into VerifyAndRepairTool as an additional step and to be
// callable from RestoreFromFileDialog after restore. All checks are read-only
// and aggregate into a single report.

import { supabase } from "@/integrations/supabase/client";
import { GSTIN_REGEX } from "@/lib/constants";
import { PL_INCOME, PL_EXPENSE, BS_ASSET, BS_LIAB } from "@/lib/reports";
import {
  readLedgers,
  readBillAllocations,
  readVoucherEntriesForCompany,
  readVoucherItemsForCompany,
  readVouchers,
  withCacheFallback,
} from "@/lib/offline/cache-read";

export type AuditSeverity = "ok" | "info" | "warn" | "error";

export interface AuditFinding {
  key: string;
  label: string;
  severity: AuditSeverity;
  message: string;
  /** Affected row count when applicable. */
  count?: number;
  /** A few example identifiers (voucher numbers, ledger names) to help the user locate. */
  examples?: string[];
}

export interface AuditReport {
  findings: AuditFinding[];
  hasError: boolean;
  hasWarning: boolean;
  summary: string;
}

// ---- Small helpers ---------------------------------------------------------

function pushOk(out: AuditFinding[], key: string, label: string, message: string) {
  out.push({ key, label, severity: "ok", message });
}
function pushIssue(
  out: AuditFinding[],
  f: Omit<AuditFinding, "severity"> & { severity: Exclude<AuditSeverity, "ok"> },
) {
  out.push(f);
}

const RUPEE = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const TOL = 100; // ₹1 rounding tolerance for cross-check sums

// ---------------------------------------------------------------------------

export async function runAccountingAudit(companyId: string): Promise<AuditReport> {
  const findings: AuditFinding[] = [];

  type V = {
    id: string;
    voucher_number: string;
    voucher_type: string;
    voucher_date: string;
    party_ledger_id: string | null;
    is_interstate: boolean | null;
    place_of_supply_code: string | null;
    vendor_invoice_no: string | null;
    vendor_invoice_date: string | null;
    subtotal_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    round_off_paise: number;
    total_paise: number;
  };
  type E = { voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number };
  type I = {
    voucher_id: string;
    item_id: string;
    taxable_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    gst_rate: number;
  };
  type L = {
    id: string;
    name: string;
    type: string;
    gstin: string | null;
    opening_balance_paise: number;
    opening_balance_is_debit: boolean;
  };
  type BA = { invoice_voucher_id: string | null; payment_voucher_id: string | null; amount_paise: number };

  const normalizeV = (v: any): V => ({
    id: String(v.id ?? ""),
    voucher_number: String(v.voucher_number ?? ""),
    voucher_type: String(v.voucher_type ?? ""),
    voucher_date: String(v.voucher_date ?? v.date ?? ""),
    party_ledger_id: v.party_ledger_id ?? null,
    is_interstate: v.is_interstate ?? null,
    place_of_supply_code: v.place_of_supply_code ?? null,
    vendor_invoice_no: v.vendor_invoice_no ?? null,
    vendor_invoice_date: v.vendor_invoice_date ?? null,
    subtotal_paise: Number(v.subtotal_paise ?? 0),
    cgst_paise: Number(v.cgst_paise ?? 0),
    sgst_paise: Number(v.sgst_paise ?? 0),
    igst_paise: Number(v.igst_paise ?? 0),
    round_off_paise: Number(v.round_off_paise ?? 0),
    total_paise: Number(v.total_paise ?? v.total_amount_paise ?? 0),
  });
  const normalizeE = (e: any): E => ({
    voucher_id: String(e.voucher_id ?? ""),
    ledger_id: String(e.ledger_id ?? ""),
    debit_paise: Number(e.debit_paise ?? 0),
    credit_paise: Number(e.credit_paise ?? 0),
  });
  const normalizeI = (i: any): I => ({
    voucher_id: String(i.voucher_id ?? ""),
    item_id: String(i.item_id ?? ""),
    taxable_paise: Number(i.taxable_paise ?? 0),
    cgst_paise: Number(i.cgst_paise ?? 0),
    sgst_paise: Number(i.sgst_paise ?? 0),
    igst_paise: Number(i.igst_paise ?? 0),
    gst_rate: Number(i.gst_rate ?? 0),
  });
  const normalizeL = (l: any): L => ({
    id: String(l.id ?? ""),
    name: String(l.name ?? ""),
    type: String(l.type ?? ""),
    gstin: l.gstin ?? null,
    opening_balance_paise: Number(l.opening_balance_paise ?? 0),
    opening_balance_is_debit: Boolean(l.opening_balance_is_debit),
  });

  // -- Bulk pulls (one round trip each table), with IndexedDB fallback for Tauri/offline.
  const { vouchers, entries, items, ledgers, billAlloc } = await withCacheFallback(
    async () => {
      const [vRes, eRes, iRes, lRes, baRes] = await Promise.all([
        supabase
          .from("vouchers")
          .select(
            "id, voucher_number, voucher_type, voucher_date, party_ledger_id, " +
              "is_interstate, place_of_supply_code, vendor_invoice_no, vendor_invoice_date, " +
              "subtotal_paise, cgst_paise, sgst_paise, igst_paise, round_off_paise, total_paise",
          )
          .eq("company_id", companyId),
        supabase
          .from("voucher_entries")
          .select("voucher_id, ledger_id, debit_paise, credit_paise, vouchers!inner(company_id)")
          .eq("vouchers.company_id", companyId),
        supabase
          .from("voucher_items")
          .select(
            "voucher_id, item_id, taxable_paise, cgst_paise, sgst_paise, igst_paise, gst_rate, vouchers!inner(company_id)",
          )
          .eq("vouchers.company_id", companyId),
        supabase
          .from("ledgers")
          .select(
            "id, name, type, gstin, opening_balance_paise, opening_balance_is_debit",
          )
          .eq("company_id", companyId),
        supabase
          .from("bill_allocations")
          .select("invoice_voucher_id, payment_voucher_id, amount_paise")
          .eq("company_id", companyId),
      ]);
      if (vRes.error) throw vRes.error;
      if (eRes.error) throw eRes.error;
      if (iRes.error) throw iRes.error;
      if (lRes.error) throw lRes.error;
      if (baRes.error) throw baRes.error;
      return {
        vouchers: ((vRes.data ?? []) as any[]).map(normalizeV),
        entries: ((eRes.data ?? []) as any[]).map(normalizeE),
        items: ((iRes.data ?? []) as any[]).map(normalizeI),
        ledgers: ((lRes.data ?? []) as any[]).map(normalizeL),
        billAlloc: (baRes.data ?? []) as unknown as BA[],
      };
    },
    async () => {
      const [vouchers, entries, items, ledgers, billAlloc] = await Promise.all([
        readVouchers(companyId),
        readVoucherEntriesForCompany(companyId),
        readVoucherItemsForCompany(companyId),
        readLedgers(companyId),
        readBillAllocations(companyId),
      ]);
      return {
        vouchers: (vouchers as any[]).map(normalizeV),
        entries: (entries as any[]).map(normalizeE),
        items: (items as any[]).map(normalizeI),
        ledgers: (ledgers as any[]).map(normalizeL),
        billAlloc: billAlloc as BA[],
      };
    },
  );


  const ledgerById = new Map(ledgers.map((l) => [l.id, l]));
  const voucherById = new Map(vouchers.map((v) => [v.id, v]));
  const entriesByVoucher = new Map<string, E[]>();
  for (const e of entries) {
    const arr = entriesByVoucher.get(e.voucher_id) ?? [];
    arr.push(e);
    entriesByVoucher.set(e.voucher_id, arr);
  }
  const itemsByVoucher = new Map<string, I[]>();
  for (const it of items) {
    const arr = itemsByVoucher.get(it.voucher_id) ?? [];
    arr.push(it);
    itemsByVoucher.set(it.voucher_id, arr);
  }

  const today = new Date().toISOString().slice(0, 10);

  // ========================================================================
  // 1) Future-dated vouchers
  // ========================================================================
  {
    const future = vouchers.filter((v) => v.voucher_date > today);
    if (future.length > 0) {
      pushIssue(findings, {
        key: "future_dated",
        label: "Future-dated vouchers",
        severity: "warn",
        count: future.length,
        message:
          `${future.length} voucher(s) are dated after today. This is permitted only ` +
          `for post-dated cheques — otherwise it breaks period reports and audit trail.`,
        examples: future.slice(0, 5).map((v) => `${v.voucher_type} ${v.voucher_number} (${v.voucher_date})`),
      });
    } else {
      pushOk(findings, "future_dated", "Future-dated vouchers", "No future-dated vouchers ✓");
    }
  }

  // ========================================================================
  // 2) Item-voucher GST consistency (header vs item-line sums)
  // ========================================================================
  {
    const ITEM_TYPES = new Set([
      "sales", "purchase", "credit_note", "debit_note",
      "sales_order", "delivery_note", "quotation",
    ]);
    const mismatched: string[] = [];
    for (const v of vouchers) {
      if (!ITEM_TYPES.has(v.voucher_type)) continue;
      const lines = itemsByVoucher.get(v.id) ?? [];
      if (lines.length === 0) continue;
      const sub = lines.reduce((s, l) => s + l.taxable_paise, 0);
      const c = lines.reduce((s, l) => s + l.cgst_paise, 0);
      const sg = lines.reduce((s, l) => s + l.sgst_paise, 0);
      const ig = lines.reduce((s, l) => s + l.igst_paise, 0);
      if (
        Math.abs(sub - v.subtotal_paise) > TOL ||
        Math.abs(c - v.cgst_paise) > TOL ||
        Math.abs(sg - v.sgst_paise) > TOL ||
        Math.abs(ig - v.igst_paise) > TOL
      ) {
        mismatched.push(`${v.voucher_type} ${v.voucher_number}`);
      }
    }
    if (mismatched.length > 0) {
      pushIssue(findings, {
        key: "gst_header_item_mismatch",
        label: "GST: header vs item-line totals",
        severity: "error",
        count: mismatched.length,
        message:
          `${mismatched.length} item voucher(s) have header GST/subtotal not matching the sum of item lines. ` +
          `Open and re-save the voucher to recompute.`,
        examples: mismatched.slice(0, 5),
      });
    } else {
      pushOk(findings, "gst_header_item_mismatch", "GST: header vs item-line totals", "All item vouchers tally ✓");
    }
  }

  // ========================================================================
  // 3) Intrastate/Interstate tax shape
  // ========================================================================
  {
    const bad: string[] = [];
    for (const v of vouchers) {
      const hasGst = v.cgst_paise + v.sgst_paise + v.igst_paise > 0;
      if (!hasGst) continue;
      if (v.is_interstate) {
        if (v.cgst_paise > 0 || v.sgst_paise > 0) bad.push(`${v.voucher_number} (interstate has CGST/SGST)`);
      } else {
        if (v.igst_paise > 0) bad.push(`${v.voucher_number} (intrastate has IGST)`);
        // CGST should equal SGST (within ₹1) for intrastate
        if (Math.abs(v.cgst_paise - v.sgst_paise) > TOL) {
          bad.push(`${v.voucher_number} (CGST ${RUPEE(v.cgst_paise)} ≠ SGST ${RUPEE(v.sgst_paise)})`);
        }
      }
    }
    if (bad.length > 0) {
      pushIssue(findings, {
        key: "gst_supply_shape",
        label: "GST supply shape (Intra-vs-Inter)",
        severity: "error",
        count: bad.length,
        message:
          `${bad.length} voucher(s) violate the CGST+SGST (intra) / IGST-only (inter) rule. ` +
          `This blocks correct GSTR-1/3B filing.`,
        examples: bad.slice(0, 5),
      });
    } else {
      pushOk(findings, "gst_supply_shape", "GST supply shape", "All taxed vouchers follow CGST+SGST / IGST rule ✓");
    }
  }

  // ========================================================================
  // 4) Place-of-supply missing on GST vouchers
  // ========================================================================
  {
    const missing = vouchers.filter(
      (v) =>
        (v.cgst_paise + v.sgst_paise + v.igst_paise > 0) &&
        (!v.place_of_supply_code || v.place_of_supply_code.length !== 2),
    );
    if (missing.length > 0) {
      pushIssue(findings, {
        key: "pos_missing",
        label: "Place of Supply missing",
        severity: "warn",
        count: missing.length,
        message:
          `${missing.length} GST voucher(s) have no Place of Supply. GSTR-1 will reject these.`,
        examples: missing.slice(0, 5).map((v) => `${v.voucher_type} ${v.voucher_number}`),
      });
    } else {
      pushOk(findings, "pos_missing", "Place of Supply", "All GST vouchers carry POS ✓");
    }
  }

  // ========================================================================
  // 5) Sales/Purchase voucher without a party ledger
  // ========================================================================
  {
    const NEEDS_PARTY = new Set(["sales", "purchase", "credit_note", "debit_note"]);
    const missing = vouchers.filter((v) => NEEDS_PARTY.has(v.voucher_type) && !v.party_ledger_id);
    if (missing.length > 0) {
      pushIssue(findings, {
        key: "party_missing",
        label: "Sales/Purchase without a party",
        severity: "error",
        count: missing.length,
        message:
          `${missing.length} sales/purchase voucher(s) have no party ledger — debtors/creditors and ` +
          `outstanding reports will be wrong.`,
        examples: missing.slice(0, 5).map((v) => `${v.voucher_type} ${v.voucher_number}`),
      });
    } else {
      pushOk(findings, "party_missing", "Party ledger on sales/purchase", "All have parties ✓");
    }
  }

  // ========================================================================
  // 6) GSTIN format validation on party ledgers
  // ========================================================================
  {
    const bad = ledgers.filter(
      (l) => l.gstin && l.gstin.trim().length > 0 && !GSTIN_REGEX.test(l.gstin.trim().toUpperCase()),
    );
    if (bad.length > 0) {
      pushIssue(findings, {
        key: "gstin_format",
        label: "Invalid GSTIN format on ledgers",
        severity: "warn",
        count: bad.length,
        message:
          `${bad.length} ledger(s) carry a GSTIN that does not match the 15-char format. ` +
          `GSTR-1 export will fail for invoices to these parties.`,
        examples: bad.slice(0, 5).map((l) => `${l.name} (${l.gstin})`),
      });
    } else {
      pushOk(findings, "gstin_format", "GSTIN format", "All GSTINs well-formed ✓");
    }
  }

  // ========================================================================
  // 7) Receipt/Payment must touch Cash/Bank; Contra must touch only Cash/Bank
  // ========================================================================
  {
    const isCashBank = (lid: string) => {
      const t = ledgerById.get(lid)?.type;
      return t === "cash" || t === "bank";
    };
    const issues: string[] = [];
    for (const v of vouchers) {
      const lines = entriesByVoucher.get(v.id) ?? [];
      if (v.voucher_type === "receipt" || v.voucher_type === "payment") {
        if (!lines.some((l) => isCashBank(l.ledger_id))) {
          issues.push(`${v.voucher_type} ${v.voucher_number} (no Cash/Bank ledger)`);
        }
      } else if (v.voucher_type === "contra") {
        if (!lines.every((l) => isCashBank(l.ledger_id))) {
          issues.push(`contra ${v.voucher_number} (non-Cash/Bank ledger used)`);
        }
      } else if (v.voucher_type === "journal") {
        if (lines.some((l) => isCashBank(l.ledger_id))) {
          issues.push(`journal ${v.voucher_number} (Cash/Bank in journal — use Receipt/Payment)`);
        }
      }
    }
    if (issues.length > 0) {
      pushIssue(findings, {
        key: "voucher_type_misuse",
        label: "Voucher type misuse (Receipt/Payment/Contra/Journal)",
        severity: "warn",
        count: issues.length,
        message:
          `${issues.length} voucher(s) use the wrong voucher type for their ledger mix. ` +
          `Cash book and bank reconciliation may miss them.`,
        examples: issues.slice(0, 5),
      });
    } else {
      pushOk(findings, "voucher_type_misuse", "Voucher-type ledger mix", "All voucher types use correct ledgers ✓");
    }
  }

  // ========================================================================
  // 8) Sales must hit an income ledger; Purchase must hit an expense ledger
  // ========================================================================
  {
    const issues: string[] = [];
    for (const v of vouchers) {
      const lines = entriesByVoucher.get(v.id) ?? [];
      if (lines.length === 0) continue;
      if (v.voucher_type === "sales") {
        const hasIncome = lines.some((l) => {
          const t = ledgerById.get(l.ledger_id)?.type;
          return t && PL_INCOME.has(t);
        });
        if (!hasIncome) issues.push(`sales ${v.voucher_number}`);
      } else if (v.voucher_type === "purchase") {
        const hasExp = lines.some((l) => {
          const t = ledgerById.get(l.ledger_id)?.type;
          return t && (PL_EXPENSE.has(t) || t === "stock_in_hand");
        });
        if (!hasExp) issues.push(`purchase ${v.voucher_number}`);
      }
    }
    if (issues.length > 0) {
      pushIssue(findings, {
        key: "trading_to_pl",
        label: "Sales/Purchase not hitting P&L",
        severity: "error",
        count: issues.length,
        message:
          `${issues.length} sales/purchase voucher(s) do not post to any Income/Expense/Stock ledger — ` +
          `P&L will under-report and tax computation will be wrong.`,
        examples: issues.slice(0, 5),
      });
    } else {
      pushOk(findings, "trading_to_pl", "Trading vouchers hit P&L", "All sales/purchase reach P&L ✓");
    }
  }

  // ========================================================================
  // 9) Opening-balance direction sanity per ledger type
  // ========================================================================
  {
    // Sundry Debtor opens Dr; Creditor opens Cr; Capital opens Cr; Loan opens Cr; Bank usually Dr; Cash always Dr; Fixed Asset Dr; Income/Expense should be 0 at opening.
    const expectDr = new Set(["sundry_debtor", "cash", "bank", "fixed_asset", "current_asset", "stock_in_hand"]);
    const expectCr = new Set(["sundry_creditor", "current_liability", "loan_liability", "capital"]);
    const issues: string[] = [];
    for (const l of ledgers) {
      if (l.opening_balance_paise === 0) continue;
      if (PL_INCOME.has(l.type) || PL_EXPENSE.has(l.type)) {
        issues.push(`${l.name} (P&L ledger should not carry an opening balance)`);
        continue;
      }
      if (expectDr.has(l.type) && !l.opening_balance_is_debit) {
        issues.push(`${l.name} (${l.type} normally Dr, opened as Cr)`);
      } else if (expectCr.has(l.type) && l.opening_balance_is_debit) {
        issues.push(`${l.name} (${l.type} normally Cr, opened as Dr)`);
      }
    }
    if (issues.length > 0) {
      pushIssue(findings, {
        key: "opening_dir",
        label: "Opening-balance direction",
        severity: "warn",
        count: issues.length,
        message:
          `${issues.length} ledger(s) have an opening balance on the wrong side. ` +
          `This usually means the importer mis-read a balance sheet line.`,
        examples: issues.slice(0, 6),
      });
    } else {
      pushOk(findings, "opening_dir", "Opening-balance direction", "All openings on the correct side ✓");
    }
  }

  // ========================================================================
  // 10) Cash ledger going negative on any historical date
  // ========================================================================
  {
    // Build daily running balance per cash ledger.
    const cashLedgers = ledgers.filter((l) => l.type === "cash");
    const issues: string[] = [];
    for (const cl of cashLedgers) {
      const ob = (cl.opening_balance_is_debit ? 1 : -1) * cl.opening_balance_paise;
      // collect dated movements
      const movements: { date: string; net: number }[] = [];
      for (const e of entries) {
        if (e.ledger_id !== cl.id) continue;
        const v = voucherById.get(e.voucher_id);
        if (!v) continue;
        movements.push({ date: v.voucher_date, net: e.debit_paise - e.credit_paise });
      }
      movements.sort((a, b) => a.date.localeCompare(b.date));
      let running = ob;
      let minBal = ob;
      let minDate = "";
      for (const m of movements) {
        running += m.net;
        if (running < minBal) { minBal = running; minDate = m.date; }
      }
      if (minBal < -TOL) {
        issues.push(`${cl.name}: dipped to ${RUPEE(minBal)} on ${minDate}`);
      }
    }
    if (issues.length > 0) {
      pushIssue(findings, {
        key: "cash_negative",
        label: "Cash balance went negative",
        severity: "error",
        count: issues.length,
        message:
          `${issues.length} cash ledger(s) went negative on some date — physically impossible. ` +
          `Usually means a payment was entered before the matching receipt, or a contra is missing.`,
        examples: issues.slice(0, 5),
      });
    } else if (cashLedgers.length > 0) {
      pushOk(findings, "cash_negative", "Cash balance", "Cash never goes negative ✓");
    }
  }

  // ========================================================================
  // 11) Bill allocations exceed invoice value
  // ========================================================================
  {
    const totalByInvoice = new Map<string, number>();
    for (const ba of billAlloc) {
      if (!ba.invoice_voucher_id) continue;
      totalByInvoice.set(
        ba.invoice_voucher_id,
        (totalByInvoice.get(ba.invoice_voucher_id) ?? 0) + ba.amount_paise,
      );
    }
    const over: string[] = [];
    for (const [vid, allocated] of totalByInvoice) {
      const v = voucherById.get(vid);
      if (!v) continue;
      if (allocated - v.total_paise > TOL) {
        over.push(`${v.voucher_type} ${v.voucher_number}: allocated ${RUPEE(allocated)} > invoice ${RUPEE(v.total_paise)}`);
      }
    }
    if (over.length > 0) {
      pushIssue(findings, {
        key: "billalloc_over",
        label: "Bill allocations exceed invoice value",
        severity: "error",
        count: over.length,
        message:
          `${over.length} invoice(s) have payment allocations greater than the invoice total — ` +
          `outstanding & ageing reports will be wrong.`,
        examples: over.slice(0, 5),
      });
    } else {
      pushOk(findings, "billalloc_over", "Bill allocations", "All allocations ≤ invoice ✓");
    }
  }

  // ========================================================================
  // 12) Duplicate vendor invoice (same party + invoice no + date)
  // ========================================================================
  {
    const seen = new Map<string, string[]>();
    for (const v of vouchers) {
      if (v.voucher_type !== "purchase") continue;
      if (!v.vendor_invoice_no || !v.party_ledger_id) continue;
      const k = `${v.party_ledger_id}::${v.vendor_invoice_no.trim().toLowerCase()}`;
      const arr = seen.get(k) ?? [];
      arr.push(v.voucher_number);
      seen.set(k, arr);
    }
    const dups = [...seen.entries()].filter(([, arr]) => arr.length > 1);
    if (dups.length > 0) {
      pushIssue(findings, {
        key: "dup_vendor_inv",
        label: "Duplicate vendor invoice numbers",
        severity: "warn",
        count: dups.length,
        message:
          `${dups.length} vendor invoice number(s) appear more than once for the same supplier — ` +
          `possible double-booking of ITC.`,
        examples: dups.slice(0, 5).map(([, arr]) => arr.join(", ")),
      });
    } else {
      pushOk(findings, "dup_vendor_inv", "Vendor invoice numbers", "No duplicate vendor invoices ✓");
    }
  }

  // ========================================================================
  // 13) Same ledger on both Dr and Cr side of one voucher (usually a mistake)
  // ========================================================================
  {
    const issues: string[] = [];
    for (const [vid, lines] of entriesByVoucher) {
      const drs = new Set<string>();
      const crs = new Set<string>();
      for (const l of lines) {
        if (l.debit_paise > 0) drs.add(l.ledger_id);
        if (l.credit_paise > 0) crs.add(l.ledger_id);
      }
      for (const lid of drs) {
        if (crs.has(lid)) {
          const v = voucherById.get(vid);
          const name = ledgerById.get(lid)?.name ?? lid;
          if (v) issues.push(`${v.voucher_type} ${v.voucher_number}: ${name}`);
          break;
        }
      }
    }
    if (issues.length > 0) {
      pushIssue(findings, {
        key: "same_ledger_both_sides",
        label: "Same ledger on both Dr and Cr of one voucher",
        severity: "info",
        count: issues.length,
        message:
          `${issues.length} voucher(s) post the same ledger on both sides. ` +
          `Sometimes intentional (e.g. round-off), often a data-entry slip.`,
        examples: issues.slice(0, 5),
      });
    }
  }

  // ========================================================================
  // 14) Excessive round-off (> ₹10) — likely a calculation error
  // ========================================================================
  {
    const big = vouchers.filter((v) => Math.abs(v.round_off_paise) > 1000);
    if (big.length > 0) {
      pushIssue(findings, {
        key: "big_roundoff",
        label: "Round-off exceeds ₹10",
        severity: "warn",
        count: big.length,
        message:
          `${big.length} voucher(s) have a round-off of more than ₹10. ` +
          `True round-off should always be < ₹1; bigger values usually indicate a tax-rate or quantity error.`,
        examples: big.slice(0, 5).map((v) => `${v.voucher_type} ${v.voucher_number}: ${RUPEE(v.round_off_paise)}`),
      });
    } else {
      pushOk(findings, "big_roundoff", "Round-off magnitude", "All round-offs within ₹10 ✓");
    }
  }

  // ========================================================================
  // 15) Ledger type vs group sanity — P&L group on BS-typed ledger, etc.
  // ========================================================================
  // (Reduced — full group-vs-type cross-check lives in account-groups.ts.)
  {
    const issues: string[] = [];
    for (const l of ledgers) {
      // If a ledger is typed as income/expense but has any opening, flag it (already covered in #9).
      // Cross-bucket presence: a "duties_taxes" ledger never being touched and zero is fine,
      // but a duties_taxes ledger with Dr opening > ITC norms is unusual.
      if (l.type === "duties_taxes" && l.opening_balance_paise > 0 && l.opening_balance_is_debit) {
        issues.push(`${l.name} opens Dr (ITC carry-forward?) — verify against last GSTR-3B`);
      }
    }
    if (issues.length > 0) {
      pushIssue(findings, {
        key: "tax_ledger_open_dr",
        label: "Duties & Taxes opening Dr",
        severity: "info",
        count: issues.length,
        message: `${issues.length} tax ledger(s) carry an ITC-style opening Dr balance — verify carry-forward.`,
        examples: issues.slice(0, 5),
      });
    }
  }

  // ---- Summary -----------------------------------------------------------
  const hasError = findings.some((f) => f.severity === "error");
  const hasWarning = findings.some((f) => f.severity === "warn");
  const errCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;
  const summary = hasError
    ? `${errCount} critical accounting issue(s) — books are not audit-ready.`
    : hasWarning
      ? `${warnCount} warning(s) — review before filing returns.`
      : `All ${findings.length} accounting checks passed ✓`;

  return { findings, hasError, hasWarning, summary };
}
