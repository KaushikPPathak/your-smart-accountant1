import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileJson, Upload, Download, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  convertGstr1Xlsx,
  fpFromMonth,
  fpFromQuarter,
  type ConvertResult,
} from "@/lib/gstr1-xlsx-to-json";
import { formatINR } from "@/lib/money";

export const Route = createFileRoute("/app/tools/gstr1-json")({
  head: () => ({ meta: [{ title: "GSTR-1 JSON Converter" }] }),
  component: Gstr1JsonConverter,
});

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - 3 + i);
const MONTHS = [
  ["01", "January"], ["02", "February"], ["03", "March"], ["04", "April"],
  ["05", "May"], ["06", "June"], ["07", "July"], ["08", "August"],
  ["09", "September"], ["10", "October"], ["11", "November"], ["12", "December"],
];

function Gstr1JsonConverter() {
  const [gstin, setGstin] = useState("");
  const [cadence, setCadence] = useState<"monthly" | "quarterly">("quarterly");
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [month, setMonth] = useState("06");
  const [quarter, setQuarter] = useState<"1" | "2" | "3" | "4">("1");
  const [fyStart, setFyStart] = useState(String(CURRENT_YEAR));
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const computeFp = useCallback((): string => {
    if (cadence === "monthly") return fpFromMonth(`${year}-${month}`);
    return fpFromQuarter(parseInt(fyStart, 10), parseInt(quarter, 10) as 1 | 2 | 3 | 4);
  }, [cadence, year, month, quarter, fyStart]);

  const handleFile = async (file: File) => {
    const gstinClean = gstin.trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$/.test(gstinClean)) {
      toast.error("Enter a valid 15-character GSTIN before uploading.");
      return;
    }
    setBusy(true);
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const res = convertGstr1Xlsx(buf, { gstin: gstinClean, fp: computeFp() });
      setResult(res);
      if (res.warnings.length) {
        res.warnings.forEach((w) => toast.warning(w));
      } else {
        toast.success("JSON generated. Review the summary and download.");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(`Failed to parse workbook: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    if (!result) return;
    const gstinClean = gstin.trim().toUpperCase();
    const fp = computeFp();
    const filename = `GSTR1_${gstinClean}_${fp}.json`;
    const blob = new Blob([JSON.stringify(result.json)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <FileJson className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">GSTR-1 JSON Converter</h1>
          <p className="text-sm text-muted-foreground">
            Upload the GSTN Offline Tool Excel workbook (with sheets b2b,sez,de / b2cs / hsn(b2b) / hsn(b2c) / exemp / docs) and generate a portal-ready JSON.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>1. Filing details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label htmlFor="gstin">GSTIN</Label>
            <Input
              id="gstin"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="24EAIPS7135C1ZP"
              maxLength={15}
              className="font-mono"
            />
          </div>
          <div>
            <Label>Filing frequency</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly (QRMP)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cadence === "monthly" ? (
            <>
              <div>
                <Label>Month / Year</Label>
                <div className="flex gap-2">
                  <Select value={month} onValueChange={setMonth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <Label>Quarter</Label>
                <Select value={quarter} onValueChange={(v) => setQuarter(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Q1 (Apr–Jun)</SelectItem>
                    <SelectItem value="2">Q2 (Jul–Sep)</SelectItem>
                    <SelectItem value="3">Q3 (Oct–Dec)</SelectItem>
                    <SelectItem value="4">Q4 (Jan–Mar)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Financial year starting</Label>
                <Select value={fyStart} onValueChange={setFyStart}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}-{String(y + 1).slice(-2)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="md:col-span-4 text-xs text-muted-foreground">
            Return period code (fp): <span className="font-mono">{computeFp()}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Upload workbook</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Processing…" : "Choose Excel file"}
          </Button>
          {fileName && <p className="text-sm text-muted-foreground">Selected: <span className="font-mono">{fileName}</span></p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              3. Review &amp; download
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3 text-sm">
              <Stat label="B2B invoices" value={String(result.summary.b2bInvoices)} />
              <Stat label="B2B taxable" value={formatINR(result.summary.b2bTaxable * 100)} />
              <Stat label="B2CS rows" value={String(result.summary.b2csRows)} />
              <Stat label="B2CS taxable" value={formatINR(result.summary.b2csTaxable * 100)} />
              <Stat label="Nil / Exempt / Non-GST" value={formatINR(result.summary.nilTotal * 100)} />
              <Stat label="HSN taxable" value={formatINR(result.summary.hsnTaxable * 100)} />
              <Stat label="Doc series" value={String(result.summary.docSeries)} />
              <Stat
                label="Reco diff (B2B+B2CS+Nil − HSN)"
                value={formatINR(result.summary.diff * 100)}
                warn={Math.abs(result.summary.diff) > 1}
              />
            </div>

            {Math.abs(result.summary.diff) > 1 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>HSN reconciliation mismatch</AlertTitle>
                <AlertDescription>
                  Taxable in B2B + B2CS + Nil differs from HSN by more than ₹1. The portal may reject the JSON. Verify HSN sheet totals before uploading.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2">
              <Button onClick={download}>
                <Download className="mr-2 h-4 w-4" />
                Download GSTN JSON
              </Button>
            </div>

            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Preview JSON (first 4 KB)</summary>
              <pre className="mt-2 overflow-auto text-xs">
                {JSON.stringify(result.json, null, 2).slice(0, 4096)}
              </pre>
            </details>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border p-3 ${warn ? "border-destructive/60 bg-destructive/5" : ""}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm">{value}</div>
    </div>
  );
}
