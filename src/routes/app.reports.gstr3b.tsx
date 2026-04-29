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
import { FileSpreadsheet, FileJson, Printer } from "lucide-react";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { downloadXlsx } from "@/lib/exporters";
import {
  buildGstr3B, fetchVouchers, fetchCompanyMeta, gstr3bToJson, gstr3bToXlsxSheets,
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
              <Button variant="ghost" size="sm" disabled={!built}
                onClick={() => built && downloadXlsx(`${fileBase}_summary.xlsx`, gstr3bToXlsxSheets(built))}>
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Summary
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
          <div className="hidden print:block">
            <div className="text-center">
              <div className="text-lg font-bold">FORM GSTR-3B</div>
              <div className="text-xs">[See rule 61(5)]</div>
            </div>
            <table className="mt-3 w-full text-sm">
              <tbody>
                <tr>
                  <td className="w-1/4 font-medium">GSTIN</td>
                  <td className="w-1/4">{company?.gstin || ""}</td>
                  <td className="w-1/4 font-medium">Year</td>
                  <td className="w-1/4">{period.fp.slice(2)}</td>
                </tr>
                <tr>
                  <td className="font-medium">Legal name of the registered person</td>
                  <td>{company?.name || ""}</td>
                  <td className="font-medium">Month</td>
                  <td>{(() => {
                    const names = ["", "January","February","March","April","May","June","July","August","September","October","November","December"];
                    return `${names[Number(period.fp.slice(0,2))] || period.fp.slice(0,2)} ${period.fp.slice(2)}`;
                  })()}</td>
                </tr>
              </tbody>
            </table>
          </div>

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

          <Card>
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

          <Card>
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

          <Card>
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

          <Card>
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

          <Card>
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
