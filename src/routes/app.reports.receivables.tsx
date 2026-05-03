import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { MessageCircle, Mail } from "lucide-react";
import { ReportToolbar, useFyRangeState } from "@/components/reports/ReportToolbar";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";
import { useAuth } from "@/lib/auth-context";
import { formatINR } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import { downloadPdfTable, downloadXlsx, r } from "@/lib/exporters";
import { renderReminder, whatsappLink, mailtoLink, logReminder } from "@/lib/reminders";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reports/receivables")({
  head: () => ({ meta: [{ title: "Outstanding Receivables — Reports" }] }),
  component: () => <Outstanding mode="receivables" />,
});

interface Ledger {
  id: string;
  name: string;
  type: string;
  credit_days: number;
  opening_balance_paise: number;
  opening_balance_is_debit: boolean;
  email: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  reminders_enabled: boolean;
}

interface Entry {
  ledger_id: string;
  debit_paise: number;
  credit_paise: number;
  vouchers: { voucher_date: string } | null;
}

const BUCKETS = [
  { label: "0–30", lo: 0, hi: 30 },
  { label: "31–60", lo: 31, hi: 60 },
  { label: "61–90", lo: 61, hi: 90 },
  { label: "90+", lo: 91, hi: Infinity },
];

export function Outstanding({ mode }: { mode: "receivables" | "payables" }) {
  const { activeCompanyId, activeMembership } = useCompany();
  const { user } = useAuth();
  const { from, to, setFrom, setTo } = useFyRangeState();
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [reminderTpl, setReminderTpl] = useState<string>("");

  const isRecv = mode === "receivables";
  const partyType = isRecv ? "sundry_debtor" : "sundry_creditor";
  const companyName = activeMembership?.companies.name || "Company";

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("ledgers")
      .select("id, name, type, credit_days, opening_balance_paise, opening_balance_is_debit, email, phone, whatsapp_number, reminders_enabled")
      .eq("company_id", activeCompanyId)
      .eq("type", partyType)
      .order("name")
      .then(({ data }) => setLedgers((data || []) as Ledger[]));

    supabase
      .from("company_settings")
      .select("reminder_template")
      .eq("company_id", activeCompanyId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.reminder_template) setReminderTpl(data.reminder_template);
      });
  }, [activeCompanyId, partyType]);

  useEffect(() => {
    if (!activeCompanyId) return;
    supabase
      .from("voucher_entries")
      .select("ledger_id, debit_paise, credit_paise, vouchers!inner(voucher_date, company_id)")
      .eq("vouchers.company_id", activeCompanyId)
      .lte("vouchers.voucher_date", to)
      .then(({ data }) => setEntries((data || []) as unknown as Entry[]));
  }, [activeCompanyId, to]);

  const today = new Date(to);

  const rows = useMemo(() => {
    return ledgers
      .map((l) => {
        const obSigned = (l.opening_balance_is_debit ? 1 : -1) * l.opening_balance_paise;
        const ledgerEntries = entries.filter((e) => e.ledger_id === l.id);
        const movement = ledgerEntries.reduce((s, e) => s + e.debit_paise - e.credit_paise, 0);
        const closing = obSigned + movement;
        const outstanding = isRecv ? closing : -closing;
        if (outstanding <= 0) return null;
        const openSide = ledgerEntries
          .filter((e) => (isRecv ? e.debit_paise > 0 : e.credit_paise > 0))
          .map((e) => e.vouchers?.voucher_date)
          .filter((d): d is string => !!d)
          .sort();
        const oldestDate = openSide[0] ?? null;
        const days = oldestDate
          ? Math.floor((today.getTime() - new Date(oldestDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        const overdue = Math.max(0, days - (l.credit_days || 0));
        const buckets = BUCKETS.map((b) => (days >= b.lo && days <= b.hi ? outstanding : 0));
        return { ledger: l, name: l.name, days, credit_days: l.credit_days, overdue, outstanding, buckets, oldestDate };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.outstanding - a.outstanding);
  }, [ledgers, entries, today, isRecv]);

  const totalOut = rows.reduce((s, x) => s + x.outstanding, 0);
  const totalsByBucket = BUCKETS.map((_, i) => rows.reduce((s, x) => s + x.buckets[i], 0));

  const head = ["Party", "Oldest", "Days", "Credit Days", "Overdue", ...BUCKETS.map((b) => b.label), "Total"];
  const csvBody = (): (string | number)[][] => [
    head,
    ...rows.map((x) => [
      x.name, x.oldestDate ?? "", x.days, x.credit_days, x.overdue,
      ...x.buckets.map((b) => (b ? (b / 100).toFixed(2) : "")),
      (x.outstanding / 100).toFixed(2),
    ]),
    ["TOTAL", "", "", "", "", ...totalsByBucket.map((b) => (b / 100).toFixed(2)), (totalOut / 100).toFixed(2)],
  ];

  const title = isRecv ? "Outstanding Receivables" : "Outstanding Payables";
  const slug = isRecv ? "receivables" : "payables";

  function buildMessage(row: typeof rows[number]): string {
    return renderReminder(reminderTpl || "Dear {party}, kindly clear ₹{amount} overdue by {days} days. — {company}", {
      partyName: row.name,
      amountPaise: row.outstanding,
      daysOverdue: row.overdue,
      companyName,
    });
  }

  async function sendWhatsApp(row: typeof rows[number]) {
    const msg = buildMessage(row);
    const phone = row.ledger.whatsapp_number || row.ledger.phone;
    if (!phone) { toast.error("No WhatsApp number on this party"); return; }
    window.open(whatsappLink(phone, msg), "_blank");
    if (activeCompanyId && user) {
      await logReminder({ companyId: activeCompanyId, ledgerId: row.ledger.id, channel: "whatsapp", message: msg, sentBy: user.id });
      toast.success("Reminder logged");
    }
  }

  async function sendEmail(row: typeof rows[number]) {
    const msg = buildMessage(row);
    if (!row.ledger.email) { toast.error("No email on this party"); return; }
    window.location.href = mailtoLink(row.ledger.email, `Payment reminder — ${companyName}`, msg);
    if (activeCompanyId && user) {
      await logReminder({ companyId: activeCompanyId, ledgerId: row.ledger.id, channel: "email", message: msg, sentBy: user.id });
      toast.success("Reminder logged");
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <ReportToolbar
            from={from} to={to} onFrom={setFrom} onTo={setTo}
            onExportCsv={() => downloadCsv(`${slug}-${to}.csv`, csvBody())}
            onExportXlsx={() => downloadXlsx(`${slug}-${to}.xlsx`, [{ name: title, rows: csvBody() }])}
            onExportPdf={() =>
              downloadPdfTable({
                title, subtitle: `As on ${to}`, head: [head],
                body: rows.map((x) => [
                  x.name, x.oldestDate ?? "", String(x.days), String(x.credit_days), String(x.overdue),
                  ...x.buckets.map((b) => (b ? r(b).toFixed(2) : "")),
                  r(x.outstanding).toFixed(2),
                ]),
                foot: [["TOTAL", "", "", "", "", ...totalsByBucket.map((b) => r(b).toFixed(2)), r(totalOut).toFixed(2)]],
                fileName: `${slug}-${to}.pdf`, orientation: "l",
                rightAlignCols: [2, 3, 4, 5, 6, 7, 8, 9],
              })
            }
            onPrint={() => window.print()}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            As on <strong>{to}</strong>. {isRecv && "Use the WhatsApp / Email buttons to send a reminder; the message uses the template from Settings."}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Party</TableHead>
                <TableHead>Oldest</TableHead>
                <TableHead className="text-right">Days</TableHead>
                <TableHead className="text-right">Credit Days</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                {BUCKETS.map((b) => <TableHead key={b.label} className="text-right">{b.label}</TableHead>)}
                <TableHead className="text-right">Total</TableHead>
                {isRecv && <TableHead className="text-center print:hidden">Remind</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isRecv ? 11 : 10} className="p-6 text-center text-sm text-muted-foreground">
                    Nothing outstanding.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((x) => (
                <TableRow key={x.ledger.id}>
                  <TableCell>{x.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{x.oldestDate ?? "—"}</TableCell>
                  <TableCell className="text-right">{x.days}</TableCell>
                  <TableCell className="text-right">{x.credit_days}</TableCell>
                  <TableCell className={`text-right ${x.overdue > 0 ? "text-destructive font-semibold" : ""}`}>{x.overdue}</TableCell>
                  {x.buckets.map((b, i) => (
                    <TableCell key={i} className="text-right font-mono">{b ? formatINR(b) : ""}</TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-semibold">{formatINR(x.outstanding)}</TableCell>
                  {isRecv && (
                    <TableCell className="print:hidden">
                      <div className="flex justify-center gap-1">
                        <Button size="icon" variant="ghost" onClick={() => sendWhatsApp(x)} title="WhatsApp reminder">
                          <MessageCircle className="h-4 w-4 text-accent-foreground" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => sendEmail(x)} title="Email reminder">
                          <Mail className="h-4 w-4 text-primary" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {rows.length > 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-right font-semibold">TOTAL</TableCell>
                  {totalsByBucket.map((b, i) => (
                    <TableCell key={i} className="text-right font-mono font-semibold">{b ? formatINR(b) : ""}</TableCell>
                  ))}
                  <TableCell className="text-right font-mono font-semibold">{formatINR(totalOut)}</TableCell>
                  {isRecv && <TableCell className="print:hidden" />}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
