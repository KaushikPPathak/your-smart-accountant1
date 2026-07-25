import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { useCompany } from "@/lib/company-context";
import { supabase } from "@/integrations/supabase/client";
import { formatINR } from "@/lib/money";

export const Route = createFileRoute("/app/reports/receipts-payments")({
  head: () => ({ meta: [{ title: "Receipts & Payments — Reports" }] }),
  component: ReceiptsPayments,
});

interface Row {
  ledger_id: string;
  ledger_name: string;
  ledger_type: string;
  // Split by which side of the till the money moved through.
  cashDr: number;  // paid out via cash
  bankDr: number;  // paid out via bank / cheque
  cashCr: number;  // received in cash
  bankCr: number;  // received via bank / cheque
}

interface OpeningRow {
  id: string;
  name: string;
  type: string;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
}

// Receipts & Payments Account — the classic Trust / Professional statement.
// Pure cash + bank movement summary for the period. Every debit to a
// cash/bank ledger becomes a "Receipt"; every credit becomes a "Payment",
// classified by the contra ledger's group heading.
function ReceiptsPayments() {
  const { activeCompanyId, activeMembership } = useCompany();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [rows, setRows] = useState<Row[]>([]);
  const [openingCash, setOpeningCash] = useState(0);
  const [closingCash, setClosingCash] = useState(0);
  const currency = activeMembership?.companies?.currency_code ?? "INR";

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => {
      // 1) All ledgers with opening balances (needed for opening/closing cash)
      const { data: leds } = await supabase
        .from("ledgers")
        .select("id, name, type, opening_balance_paise, opening_balance_is_debit")
        .eq("company_id", activeCompanyId)
        .eq("is_active", true);
      const ledgers = (leds ?? []) as OpeningRow[];
      const cashLedgerIds = new Set(ledgers.filter(l => l.type === "cash" || l.type === "bank").map(l => l.id));

      const openCash = ledgers
        .filter(l => cashLedgerIds.has(l.id))
        .reduce((s, l) => s + (l.opening_balance_is_debit ? 1 : -1) * (l.opening_balance_paise || 0), 0);
      setOpeningCash(openCash);

      // 2) Fetch voucher_entries touching cash/bank in the period, then pair
      //    with contra entries on the same voucher to attribute the receipt /
      //    payment head.
      const { data: vs } = await supabase
        .from("vouchers")
        .select("id")
        .eq("company_id", activeCompanyId)
        .gte("voucher_date", from)
        .lte("voucher_date", to);
      const voucherIds = (vs ?? []).map((v: { id: string }) => v.id);
      if (voucherIds.length === 0) {
        setRows([]);
        setClosingCash(openCash);
        return;
      }
      const { data: ves } = await supabase
        .from("voucher_entries")
        .select("voucher_id, ledger_id, debit_paise, credit_paise")
        .in("voucher_id", voucherIds);
      const entries = (ves ?? []) as { voucher_id: string; ledger_id: string; debit_paise: number; credit_paise: number }[];

      const byVoucher = new Map<string, typeof entries>();
      for (const e of entries) {
        const arr = byVoucher.get(e.voucher_id) ?? [];
        arr.push(e);
        byVoucher.set(e.voucher_id, arr);
      }

      const ledMap = new Map(ledgers.map(l => [l.id, l]));
      const bucket = new Map<string, Row>();

      let netCashMove = 0;
      for (const [, es] of byVoucher) {
        const cashSide = es.filter(e => cashLedgerIds.has(e.ledger_id));
        const otherSide = es.filter(e => !cashLedgerIds.has(e.ledger_id));
        if (cashSide.length === 0) continue;

        // Split cash-side movement into "cash till" vs "bank till" so contra
        // entries can be attributed to the correct receipt mode.
        let cashTillNet = 0, bankTillNet = 0;
        for (const e of cashSide) {
          const led = ledMap.get(e.ledger_id);
          const m = (e.debit_paise || 0) - (e.credit_paise || 0);
          if (led?.type === "cash") cashTillNet += m;
          else if (led?.type === "bank") bankTillNet += m;
        }
        netCashMove += cashTillNet + bankTillNet;
        const cashAbs = Math.abs(cashTillNet);
        const bankAbs = Math.abs(bankTillNet);
        const totalAbs = cashAbs + bankAbs;
        if (totalAbs === 0) continue;

        for (const e of otherSide) {
          const led = ledMap.get(e.ledger_id);
          if (!led) continue;
          const key = led.id;
          const existing = bucket.get(key) ?? {
            ledger_id: led.id, ledger_name: led.name, ledger_type: led.type,
            cashDr: 0, bankDr: 0, cashCr: 0, bankCr: 0,
          };
          const dr = e.debit_paise || 0;
          const cr = e.credit_paise || 0;
          // Split dr/cr pro-rata across cash-till vs bank-till.
          const drCash = Math.round((dr * cashAbs) / totalAbs);
          const drBank = dr - drCash;
          const crCash = Math.round((cr * cashAbs) / totalAbs);
          const crBank = cr - crCash;
          existing.cashDr += drCash;
          existing.bankDr += drBank;
          existing.cashCr += crCash;
          existing.bankCr += crBank;
          bucket.set(key, existing);
        }
      }
      setClosingCash(openCash + netCashMove);
      setRows(Array.from(bucket.values()).sort((a, b) => a.ledger_name.localeCompare(b.ledger_name)));
    })();
  }, [activeCompanyId, from, to]);

  const receipts = useMemo(
    () => rows.filter(r => (r.cashCr + r.bankCr) > 0)
      .map(r => ({ name: r.ledger_name, cash: r.cashCr, bank: r.bankCr, total: r.cashCr + r.bankCr })),
    [rows],
  );
  const payments = useMemo(
    () => rows.filter(r => (r.cashDr + r.bankDr) > 0)
      .map(r => ({ name: r.ledger_name, cash: r.cashDr, bank: r.bankDr, total: r.cashDr + r.bankDr })),
    [rows],
  );
  const totalReceipts = receipts.reduce((s, r) => s + r.total, 0);
  const totalPayments = payments.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-4">
      <ReportToolbar from={from} to={to} onFrom={setFrom} onTo={setTo} />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Receipts &amp; Payments Account — {from} to {to}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Classic Trust / Professional statement — pure cash and bank movement, without accrual adjustments.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Receipts (Cr.)</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b"><td className="py-1">To Opening Cash &amp; Bank</td><td className="py-1 text-right font-mono">{formatINR(Math.max(0, openingCash))}</td></tr>
                  {receipts.map((r) => (
                    <tr key={r.name} className="border-b">
                      <td className="py-1">To {r.name}</td>
                      <td className="py-1 text-right font-mono">{formatINR(r.amt)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="py-2">Total</td><td className="py-2 text-right font-mono">{formatINR(totalReceipts + Math.max(0, openingCash))}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Payments (Dr.)</h3>
              <table className="w-full text-sm">
                <tbody>
                  {payments.map((r) => (
                    <tr key={r.name} className="border-b">
                      <td className="py-1">By {r.name}</td>
                      <td className="py-1 text-right font-mono">{formatINR(r.amt)}</td>
                    </tr>
                  ))}
                  <tr className="border-b"><td className="py-1">By Closing Cash &amp; Bank</td><td className="py-1 text-right font-mono">{formatINR(Math.max(0, closingCash))}</td></tr>
                  <tr className="font-semibold"><td className="py-2">Total</td><td className="py-2 text-right font-mono">{formatINR(totalPayments + Math.max(0, closingCash))}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
