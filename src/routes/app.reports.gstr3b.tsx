import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileSpreadsheet, FileJson, Printer, Plus, Trash2, BookOpen } from "lucide-react";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import {
  buildGstr3B, fetchVouchers, fetchCompanyMeta, gstr3bToJson,
  monthRange, periodFP, downloadJson, fetchInwardSummary, fetchItcReversal, validateGstr3B,
  type CompanyMeta, type BuiltGstr3B, type InwardSummaryRow, type ItcReversalRow,
} from "@/lib/gst-returns";
import { downloadGstr3bOfficial } from "@/lib/gstr3b-template";
import { ValidationPanel } from "@/components/reports/ValidationPanel";

export const Route = createFileRoute("/app/reports/gstr3b")({
  head: () => ({ meta: [{ title: "GSTR-3B — Reports" }] }),
  component: GSTR3BPage,
});

const monthsOfYear = (year: number) => {
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names.map((n, i) => ({ value: `${year}-${String(i + 1).padStart(2, "0")}`, label: `${n} ${year}` }));
};

function GSTR3BPage() {
  const { activeCompanyId } = useCompany();
  const today = new Date();
  const fyYear = today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();
  const [month, setMonth] = useState<string>(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [company, setCompany] = useState<CompanyMeta | null>(null);
  const [built, setBuilt] = useState<BuiltGstr3B | null>(null);
  const [inward, setInward] = useState<InwardSummaryRow[]>([]);
  const [reversal, setReversal] = useState<ItcReversalRow[]>([]);
  const [eligibleItc, setEligibleItc] = useState<{ i: number; c: number; s: number } | null>(null);
  const [ineligible, setIneligible] = useState<{ i: number; c: number; s: number }>({ i: 0, c: 0, s: 0 });

  const period = useMemo(() => {
    const r = monthRange(month);
    return { ...r, fp: periodFP(r.from) };
  }, [month]);

  useEffect(() => {
    if (!activeCompanyId) return;
    (async () => setCompany(await fetchCompanyMeta(activeCompanyId)))();
  }, [activeCompanyId]);

  useEffect(() => {
    if (!activeCompanyId || !company) return;
    (async () => {
      const [sales, purchases, creditNotes, debitNotes, inwardRows, reversalRows] = await Promise.all([
        fetchVouchers(activeCompanyId, period.from, period.to, ["sales"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["purchase"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["credit_note"]),
        fetchVouchers(activeCompanyId, period.from, period.to, ["debit_note"]),
        fetchInwardSummary(activeCompanyId, period.fp),
        fetchItcReversal(activeCompanyId, period.fp),
      ]);
      setInward(inwardRows);
      setReversal(reversalRows);
      setBuilt(buildGstr3B({
        company, from: period.from, to: period.to, fp: period.fp,
        sales, purchases, creditNotes, debitNotes,
        inwardSummary: inwardRows, itcReversal: reversalRows,
      }));
    })();
  }, [activeCompanyId, company, period.from, period.to, period.fp]);

  const fileBase = `GSTR3B_${company?.gstin || "GSTIN"}_${period.fp}`;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 print:hidden">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Return period</Label>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[fyYear, fyYear + 1].flatMap((y) => monthsOfYear(y)).map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" disabled={!built}
                onClick={async () => {
                  if (!built) return;
                  try {
                    await downloadGstr3bOfficial(fileBase, built);
                    toast.success("GSTR-3B utility (.xlsm) generated");
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : "Failed to generate utility");
                  }
                }}>
                <FileSpreadsheet className="mr-1 h-4 w-4" /> GSTR-3B Utility (.xlsm)
              </Button>
              <Button variant="outline" size="sm" disabled={!built}
                onClick={() => built && downloadJson(`${fileBase}.json`, gstr3bToJson(built))}>
                <FileJson className="mr-1 h-4 w-4" /> GSTN JSON
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const prev = document.title;
                document.title = fileBase;
                const restore = () => {
                  document.title = prev;
                  window.removeEventListener("afterprint", restore);
                };
                window.addEventListener("afterprint", restore);
                window.print();
              }}>
                <Printer className="mr-1 h-4 w-4" /> Print
              </Button>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Period: <strong>{period.from}</strong> to <strong>{period.to}</strong> · FP <code>{period.fp}</code></p>
        </CardContent>
      </Card>

      {built && (
        <>
          <PrintableGstr3B built={built} company={company} fp={period.fp} />

          <ValidationPanel issues={validateGstr3B(built)} />

          <ManualEntryCard
            companyId={activeCompanyId!}
            period={period.fp}
            inward={inward}
            reversal={reversal}
            onChanged={async () => {
              if (!activeCompanyId || !company) return;
              const [i, r] = await Promise.all([fetchInwardSummary(activeCompanyId, period.fp), fetchItcReversal(activeCompanyId, period.fp)]);
              setInward(i); setReversal(r);
              const [sales, purchases, creditNotes, debitNotes] = await Promise.all([
                fetchVouchers(activeCompanyId, period.from, period.to, ["sales"]),
                fetchVouchers(activeCompanyId, period.from, period.to, ["purchase"]),
                fetchVouchers(activeCompanyId, period.from, period.to, ["credit_note"]),
                fetchVouchers(activeCompanyId, period.from, period.to, ["debit_note"]),
              ]);
              setBuilt(buildGstr3B({ company, from: period.from, to: period.to, fp: period.fp, sales, purchases, creditNotes, debitNotes, inwardSummary: i, itcReversal: r }));
            }}
          />

          <PurchaseExpenseLedger
            onEligibleItcChange={(v) => setEligibleItc(v)}
            ineligibleTotals={ineligible}
            setIneligibleTotals={setIneligible}
          />
          <InputOutputCalculator built={built} eligibleOverride={eligibleItc} />

          <Card className="print:hidden">
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">3.1 Outward & inward supplies on RCM</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nature of Supplies</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">Cess</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <Sup row={["(a) Outward taxable (other than zero rated, nil rated, exempted)", built.sup_details.osup_det]} />
                  <Sup row={["(b) Outward zero-rated", built.sup_details.osup_zero]} />
                  <Sup row={["(c) Other outward (nil/exempt)", built.sup_details.osup_nil_exmp]} />
                  <Sup row={["(d) Inward — reverse charge", built.sup_details.isup_rev]} />
                  <Sup row={["(e) Non-GST outward", built.sup_details.osup_nongst]} />
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">3.2 Inter-state to Unregistered (from 3.1(a))</div>
              {built.inter_sup.unreg_details.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">No inter-state B2C supplies in this period.</div>
              ) : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>POS</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {built.inter_sup.unreg_details.map((p) => (
                      <TableRow key={p.pos}>
                        <TableCell className="font-mono">{p.pos}</TableCell>
                        <TableCell className="text-right font-mono">{moneyR(p.txval)}</TableCell>
                        <TableCell className="text-right font-mono">{moneyR(p.iamt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">4. Eligible ITC</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {built.itc_elg.itc_avl.map((x, i) => (
                    <TableRow key={`avl-${i}`}>
                      <TableCell>(A) ITC Available — {x.ty === "ISRC" ? "Inward supplies (RCM)" : "All other ITC"}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.iamt)}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.camt)}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.samt)}</TableCell>
                    </TableRow>
                  ))}
                  {built.itc_elg.itc_rev.map((x, i) => (
                    <TableRow key={`rev-${i}`}>
                      <TableCell>(B) ITC Reversed — {x.ty === "RUL" ? "As per Rule 42 & 43" : "Others"}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.iamt)}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.camt)}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.samt)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="font-semibold">(C) Net ITC Available</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{moneyR(built.itc_elg.itc_net.iamt)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{moneyR(built.itc_elg.itc_net.camt)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{moneyR(built.itc_elg.itc_net.samt)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">5. Values of exempt, nil-rated and non-GST inward supplies</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nature</TableHead>
                  <TableHead className="text-right">Inter-state</TableHead>
                  <TableHead className="text-right">Intra-state</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {built.inward_sup.isup_details.map((x) => (
                    <TableRow key={x.ty}>
                      <TableCell>{x.ty === "GST" ? "From a supplier under composition / exempt / nil-rated" : "Non-GST supply"}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.inter)}</TableCell>
                      <TableCell className="text-right font-mono">{moneyR(x.intra)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="print:hidden">
            <CardContent className="p-0">
              <div className="border-b px-4 py-3 font-medium">6.1 Payment of Tax</div>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Tax Payable</TableHead>
                  <TableHead className="text-right">Net cash payable</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  <TableRow><TableCell>Integrated Tax</TableCell><TableCell className="text-right font-mono">{moneyR(built.tax_pmt.iamt)}</TableCell><TableCell className="text-right font-mono font-semibold">{moneyR(built.tax_pmt.iamt_payable)}</TableCell></TableRow>
                  <TableRow><TableCell>Central Tax</TableCell><TableCell className="text-right font-mono">{moneyR(built.tax_pmt.camt)}</TableCell><TableCell className="text-right font-mono font-semibold">{moneyR(built.tax_pmt.camt_payable)}</TableCell></TableRow>
                  <TableRow><TableCell>State/UT Tax</TableCell><TableCell className="text-right font-mono">{moneyR(built.tax_pmt.samt)}</TableCell><TableCell className="text-right font-mono font-semibold">{moneyR(built.tax_pmt.samt_payable)}</TableCell></TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function moneyR(v: number) { return formatINR(Math.round(v * 100)); }

/**
 * Print-only replica of the official GSTR-3B form (matches utility V5.8 layout/colors).
 * Uses inline styles so print PDFs render identically regardless of host theme.
 */
function PrintableGstr3B({ built, company, fp }: { built: BuiltGstr3B; company: CompanyMeta | null; fp: string }) {
  const monthNames = ["", "January","February","March","April","May","June","July","August","September","October","November","December"];
  const mm = Number(fp.slice(0, 2));
  const yyyy = Number(fp.slice(2));
  const fyStart = mm >= 4 ? yyyy : yyyy - 1;
  const yearLabel = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  const monthLabel = monthNames[mm] || "";

  const HDR = "#fff2cc"; // utility yellow band
  const SUB = "#d9e1f2"; // section sub-band (light blue)
  const BORDER = "1px solid #000";
  const cellPad = "4px 6px";
  const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 11, color: "#000" };
  const th: React.CSSProperties = { border: BORDER, padding: cellPad, background: SUB, fontWeight: 600, textAlign: "center" };
  const td: React.CSSProperties = { border: BORDER, padding: cellPad, textAlign: "right", fontFamily: "monospace" };
  const tdL: React.CSSProperties = { border: BORDER, padding: cellPad, textAlign: "left" };
  const sectionTitle: React.CSSProperties = { border: BORDER, padding: cellPad, background: HDR, fontWeight: 700, textAlign: "left" };

  const s = built.sup_details;
  const fmt = (v: number) => v ? v.toFixed(2) : "0.00";

  return (
    <div className="hidden print:block" style={{ color: "#000", background: "#fff", fontFamily: "Arial, sans-serif" }}>
      <div style={{ textAlign: "center", marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>FORM GSTR-3B</div>
        <div style={{ fontSize: 10 }}>[See rule 61(5)]</div>
      </div>
      <table style={tblStyle}>
        <tbody>
          <tr><td style={{ ...tdL, background: HDR, width: "20%", fontWeight: 600 }}>1. GSTIN</td><td style={tdL}>{company?.gstin || ""}</td><td style={{ ...tdL, background: HDR, width: "15%", fontWeight: 600 }}>Year</td><td style={tdL}>{yearLabel}</td></tr>
          <tr><td style={{ ...tdL, background: HDR, fontWeight: 600 }}>2(a). Legal name</td><td style={tdL}>{company?.name || ""}</td><td style={{ ...tdL, background: HDR, fontWeight: 600 }}>Month</td><td style={tdL}>{monthLabel}</td></tr>
        </tbody>
      </table>

      <table style={{ ...tblStyle, marginTop: 8 }}>
        <tbody>
          <tr><td colSpan={6} style={sectionTitle}>3.1 Details of Outward Supplies and inward supplies liable to reverse charge</td></tr>
          <tr>
            <th style={{ ...th, width: "40%", textAlign: "left" }}>Nature of Supplies</th>
            <th style={th}>Total taxable value</th>
            <th style={th}>Integrated Tax</th>
            <th style={th}>Central Tax</th>
            <th style={th}>State/UT Tax</th>
            <th style={th}>Cess</th>
          </tr>
          {[
            ["(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", s.osup_det],
            ["(b) Outward taxable supplies (zero rated)", s.osup_zero],
            ["(c) Other outward supplies (Nil rated, exempted)", s.osup_nil_exmp],
            ["(d) Inward supplies (liable to reverse charge)", s.isup_rev],
            ["(e) Non-GST outward supplies", s.osup_nongst],
          ].map(([label, v]) => {
            const x = v as { txval: number; iamt: number; camt: number; samt: number; csamt: number };
            return (
              <tr key={label as string}>
                <td style={tdL}>{label as string}</td>
                <td style={td}>{fmt(x.txval)}</td>
                <td style={td}>{fmt(x.iamt)}</td>
                <td style={td}>{fmt(x.camt)}</td>
                <td style={td}>{fmt(x.samt)}</td>
                <td style={td}>{fmt(x.csamt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <table style={{ ...tblStyle, marginTop: 8 }}>
        <tbody>
          <tr><td colSpan={3} style={sectionTitle}>3.2 Of the supplies shown in 3.1(a) above, details of inter-State supplies made to unregistered persons, composition taxable persons and UIN holders</td></tr>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Place of Supply (State/UT)</th>
            <th style={th}>Total Taxable value</th>
            <th style={th}>Amount of Integrated Tax</th>
          </tr>
          {built.inter_sup.unreg_details.length === 0 ? (
            <tr><td colSpan={3} style={{ ...tdL, textAlign: "center" }}>—</td></tr>
          ) : built.inter_sup.unreg_details.map((p) => (
            <tr key={p.pos}>
              <td style={tdL}>{p.pos}</td>
              <td style={td}>{fmt(p.txval)}</td>
              <td style={td}>{fmt(p.iamt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ ...tblStyle, marginTop: 8 }}>
        <tbody>
          <tr><td colSpan={4} style={sectionTitle}>4. Eligible ITC</td></tr>
          <tr>
            <th style={{ ...th, width: "55%", textAlign: "left" }}>Details</th>
            <th style={th}>Integrated Tax</th>
            <th style={th}>Central Tax</th>
            <th style={th}>State/UT Tax</th>
          </tr>
          {built.itc_elg.itc_avl.map((x, i) => (
            <tr key={`avl-${i}`}>
              <td style={tdL}>(A) ITC Available — {x.ty}</td>
              <td style={td}>{fmt(x.iamt)}</td>
              <td style={td}>{fmt(x.camt)}</td>
              <td style={td}>{fmt(x.samt)}</td>
            </tr>
          ))}
          {built.itc_elg.itc_rev.map((x, i) => (
            <tr key={`rev-${i}`}>
              <td style={tdL}>(B) ITC Reversed — {x.ty === "RUL" ? "Rule 38, 42 & 43 + Sec 17(5)" : "Others"}</td>
              <td style={td}>{fmt(x.iamt)}</td>
              <td style={td}>{fmt(x.camt)}</td>
              <td style={td}>{fmt(x.samt)}</td>
            </tr>
          ))}
          <tr style={{ background: HDR, fontWeight: 700 }}>
            <td style={tdL}>(C) Net ITC available (A) - (B)</td>
            <td style={td}>{fmt(built.itc_elg.itc_net.iamt)}</td>
            <td style={td}>{fmt(built.itc_elg.itc_net.camt)}</td>
            <td style={td}>{fmt(built.itc_elg.itc_net.samt)}</td>
          </tr>
        </tbody>
      </table>

      <table style={{ ...tblStyle, marginTop: 8 }}>
        <tbody>
          <tr><td colSpan={3} style={sectionTitle}>5. Values of exempt, nil-rated and non-GST inward supplies</td></tr>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Nature of supplies</th>
            <th style={th}>Inter-State supplies</th>
            <th style={th}>Intra-State supplies</th>
          </tr>
          {built.inward_sup.isup_details.map((x) => (
            <tr key={x.ty}>
              <td style={tdL}>{x.ty === "GST" ? "From a supplier under composition scheme, Exempt and Nil rated supply" : "Non-GST supply"}</td>
              <td style={td}>{fmt(x.inter)}</td>
              <td style={td}>{fmt(x.intra)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table style={{ ...tblStyle, marginTop: 8 }}>
        <tbody>
          <tr><td colSpan={3} style={sectionTitle}>6.1 Payment of tax</td></tr>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Description</th>
            <th style={th}>Tax Payable</th>
            <th style={th}>Paid in Cash</th>
          </tr>
          <tr><td style={tdL}>Integrated Tax</td><td style={td}>{fmt(built.tax_pmt.iamt)}</td><td style={td}>{fmt(built.tax_pmt.iamt_payable)}</td></tr>
          <tr><td style={tdL}>Central Tax</td><td style={td}>{fmt(built.tax_pmt.camt)}</td><td style={td}>{fmt(built.tax_pmt.camt_payable)}</td></tr>
          <tr><td style={tdL}>State/UT Tax</td><td style={td}>{fmt(built.tax_pmt.samt)}</td><td style={td}>{fmt(built.tax_pmt.samt_payable)}</td></tr>
        </tbody>
      </table>

      <div style={{ marginTop: 12, fontSize: 10 }}>
        Verification: I hereby solemnly affirm and declare that the information given herein above is true and correct to the best of my knowledge and belief and nothing has been concealed therefrom.
      </div>
    </div>
  );
}

function Sup({ row }: { row: [string, { txval: number; iamt: number; camt: number; samt: number; csamt: number }] }) {
  const [label, s] = row;
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.txval)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.iamt)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.camt)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.samt)}</TableCell>
      <TableCell className="text-right font-mono">{moneyR(s.csamt)}</TableCell>
    </TableRow>
  );
}

function ManualEntryCard({ companyId, period, inward, reversal, onChanged }: {
  companyId: string; period: string;
  inward: InwardSummaryRow[]; reversal: ItcReversalRow[];
  onChanged: () => void | Promise<void>;
}) {
  const inwGst = inward.find((x) => x.ty === "GST") ?? { ty: "GST" as const, inter_paise: 0, intra_paise: 0 };
  const inwNon = inward.find((x) => x.ty === "NONGST") ?? { ty: "NONGST" as const, inter_paise: 0, intra_paise: 0 };
  const revRul = reversal.find((x) => x.ty === "RUL") ?? { ty: "RUL" as const, iamt_paise: 0, camt_paise: 0, samt_paise: 0, csamt_paise: 0 };
  const revOth = reversal.find((x) => x.ty === "OTH") ?? { ty: "OTH" as const, iamt_paise: 0, camt_paise: 0, samt_paise: 0, csamt_paise: 0 };

  const [gInter, setGInter] = useState((inwGst.inter_paise / 100).toString());
  const [gIntra, setGIntra] = useState((inwGst.intra_paise / 100).toString());
  const [nInter, setNInter] = useState((inwNon.inter_paise / 100).toString());
  const [nIntra, setNIntra] = useState((inwNon.intra_paise / 100).toString());
  const [rRulI, setRRulI] = useState((revRul.iamt_paise / 100).toString());
  const [rRulC, setRRulC] = useState((revRul.camt_paise / 100).toString());
  const [rRulS, setRRulS] = useState((revRul.samt_paise / 100).toString());
  const [rOthI, setROthI] = useState((revOth.iamt_paise / 100).toString());
  const [rOthC, setROthC] = useState((revOth.camt_paise / 100).toString());
  const [rOthS, setROthS] = useState((revOth.samt_paise / 100).toString());
  const [saving, setSaving] = useState(false);

  const toPaise = (v: string) => Math.round((Number(v) || 0) * 100);

  const save = async () => {
    setSaving(true);
    try {
      const inwardRows = [
        { company_id: companyId, period, ty: "GST", inter_paise: toPaise(gInter), intra_paise: toPaise(gIntra) },
        { company_id: companyId, period, ty: "NONGST", inter_paise: toPaise(nInter), intra_paise: toPaise(nIntra) },
      ];
      const revRows = [
        { company_id: companyId, period, ty: "RUL", iamt_paise: toPaise(rRulI), camt_paise: toPaise(rRulC), samt_paise: toPaise(rRulS), csamt_paise: 0 },
        { company_id: companyId, period, ty: "OTH", iamt_paise: toPaise(rOthI), camt_paise: toPaise(rOthC), samt_paise: toPaise(rOthS), csamt_paise: 0 },
      ];
      const [r1, r2] = await Promise.all([
        supabase.from("gstr3b_inward_summary").upsert(inwardRows, { onConflict: "company_id,period,ty" }),
        supabase.from("gstr3b_itc_reversal").upsert(revRows, { onConflict: "company_id,period,ty" }),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      toast.success("Saved manual entries");
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4 print:hidden">
        <div className="text-sm font-medium">Manual entries for {period}</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Section 5 — Inward exempt/nil/non-GST (₹)</div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">GST inter-state</Label><Input value={gInter} onChange={(e) => setGInter(e.target.value)} /></div>
              <div><Label className="text-xs">GST intra-state</Label><Input value={gIntra} onChange={(e) => setGIntra(e.target.value)} /></div>
              <div><Label className="text-xs">Non-GST inter</Label><Input value={nInter} onChange={(e) => setNInter(e.target.value)} /></div>
              <div><Label className="text-xs">Non-GST intra</Label><Input value={nIntra} onChange={(e) => setNIntra(e.target.value)} /></div>
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-muted-foreground">Section 4(B) — ITC Reversal (₹)</div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Rule 42/43 IGST</Label><Input value={rRulI} onChange={(e) => setRRulI(e.target.value)} /></div>
              <div><Label className="text-xs">Rule 42/43 CGST</Label><Input value={rRulC} onChange={(e) => setRRulC(e.target.value)} /></div>
              <div><Label className="text-xs">Rule 42/43 SGST</Label><Input value={rRulS} onChange={(e) => setRRulS(e.target.value)} /></div>
              <div><Label className="text-xs">Others IGST</Label><Input value={rOthI} onChange={(e) => setROthI(e.target.value)} /></div>
              <div><Label className="text-xs">Others CGST</Label><Input value={rOthC} onChange={(e) => setROthC(e.target.value)} /></div>
              <div><Label className="text-xs">Others SGST</Label><Input value={rOthS} onChange={(e) => setROthS(e.target.value)} /></div>
            </div>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save manual entries"}</Button>
      </CardContent>
    </Card>
  );
}

/**
 * GST Input / Output Calculator — Section 49 of CGST Act, 2017 read with
 * Rules 86A/86B and Section 49A/49B (ITC utilisation order).
 * Output tax (liability) is offset against eligible ITC in the prescribed
 * order; remainder is the net cash payable per head.
 */
function InputOutputCalculator({ built }: { built: BuiltGstr3B }) {
  // Output tax liability (₹) — Table 3.1(a) + 3.1(b) IGST + 3.1(d) RCM
  const out_i = built.sup_details.osup_det.iamt + built.sup_details.osup_zero.iamt + built.sup_details.isup_rev.iamt;
  const out_c = built.sup_details.osup_det.camt + built.sup_details.isup_rev.camt;
  const out_s = built.sup_details.osup_det.samt + built.sup_details.isup_rev.samt;

  // Net ITC available (Table 4C)
  let itc_i = built.itc_elg.itc_net.iamt;
  let itc_c = built.itc_elg.itc_net.camt;
  let itc_s = built.itc_elg.itc_net.samt;

  // Utilisation per Section 49A/49B + Rule 88A (IGST exhausted first; CGST/SGST cannot cross-set-off).
  // Step 1: pay IGST liability with IGST credit
  const u_ii = Math.min(out_i, itc_i); itc_i -= u_ii;
  // Step 2: pay CGST liability with IGST credit
  const remCAfterIGST = out_c - 0;
  const u_ic = Math.min(remCAfterIGST, itc_i); itc_i -= u_ic;
  // Step 3: pay SGST liability with remaining IGST credit
  const remSAfterIGST = out_s - 0;
  const u_is = Math.min(remSAfterIGST, itc_i); itc_i -= u_is;
  // Step 4: pay remaining CGST liability with CGST credit
  const remC2 = out_c - u_ic;
  const u_cc = Math.min(remC2, itc_c); itc_c -= u_cc;
  // Step 5: pay remaining SGST liability with SGST credit
  const remS2 = out_s - u_is;
  const u_ss = Math.min(remS2, itc_s); itc_s -= u_ss;
  // Step 6: pay remaining IGST liability with CGST then SGST (rare but legal)
  const remI2 = out_i - u_ii;
  const u_ci = Math.min(remI2, itc_c); itc_c -= u_ci;
  const u_si = Math.min(remI2 - u_ci, itc_s); itc_s -= u_si;

  const cash_i = Math.max(0, out_i - u_ii - u_ci - u_si);
  const cash_c = Math.max(0, out_c - u_cc - u_ic);
  const cash_s = Math.max(0, out_s - u_ss - u_is);

  const closing_i = itc_i;
  const closing_c = itc_c;
  const closing_s = itc_s;

  const fmt = (v: number) => formatINR(Math.round(v * 100));

  return (
    <Card className="print:hidden">
      <CardContent className="p-0">
        <div className="border-b px-4 py-3">
          <div className="font-medium">GST Input / Output Calculator</div>
          <div className="text-xs text-muted-foreground">As per Section 49, 49A, 49B of CGST Act, 2017 and Rule 88A — ITC utilisation in prescribed order.</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Particulars</TableHead>
              <TableHead className="text-right">IGST</TableHead>
              <TableHead className="text-right">CGST</TableHead>
              <TableHead className="text-right">SGST/UTGST</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow><TableCell className="font-medium">Output tax (liability)</TableCell>
              <TableCell className="text-right font-mono">{fmt(out_i)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(out_c)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(out_s)}</TableCell></TableRow>
            <TableRow><TableCell className="font-medium">Input tax credit available (Table 4C)</TableCell>
              <TableCell className="text-right font-mono">{fmt(built.itc_elg.itc_net.iamt)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(built.itc_elg.itc_net.camt)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(built.itc_elg.itc_net.samt)}</TableCell></TableRow>
            <TableRow className="bg-muted/40"><TableCell colSpan={4} className="text-xs font-semibold">Set-off as per Sec 49A/49B + Rule 88A</TableCell></TableRow>
            <TableRow><TableCell>Less: IGST credit utilised</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_ii)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_ic)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_is)}</TableCell></TableRow>
            <TableRow><TableCell>Less: CGST credit utilised</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_ci)}</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_cc)}</TableCell>
              <TableCell className="text-right font-mono">—</TableCell></TableRow>
            <TableRow><TableCell>Less: SGST credit utilised</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_si)}</TableCell>
              <TableCell className="text-right font-mono">—</TableCell>
              <TableCell className="text-right font-mono">{fmt(u_ss)}</TableCell></TableRow>
            <TableRow className="bg-primary/5"><TableCell className="font-semibold">Net tax payable in cash</TableCell>
              <TableCell className="text-right font-mono font-semibold">{fmt(cash_i)}</TableCell>
              <TableCell className="text-right font-mono font-semibold">{fmt(cash_c)}</TableCell>
              <TableCell className="text-right font-mono font-semibold">{fmt(cash_s)}</TableCell></TableRow>
            <TableRow><TableCell className="text-xs text-muted-foreground">Closing ITC balance (carried forward)</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmt(closing_i)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmt(closing_c)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmt(closing_s)}</TableCell></TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
