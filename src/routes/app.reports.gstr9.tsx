import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Printer,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/lib/company-context";
import { formatINR } from "@/lib/money";
import { fetchCompanyMeta, type CompanyMeta } from "@/lib/gst-returns";
import {
  financialYearRange,
  loadGstr9Books,
  validateGstr9,
  type Gstr9Result,
  type Gstr9SourceStatus,
  type Gstr9TaxTotals,
} from "@/lib/gstr9";

export const Route = createFileRoute("/app/reports/gstr9")({
  head: () => ({ meta: [{ title: "GSTR-9 — Reports" }] }),
  component: GSTR9Page,
});

function currentFinancialYear(): string {
  const today = new Date();
  const startYear =
    today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();

  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function financialYearOptions(): string[] {
  const today = new Date();
  const currentStart =
    today.getMonth() < 3 ? today.getFullYear() - 1 : today.getFullYear();

  return Array.from({ length: 7 }, (_, index) => {
    const startYear = currentStart - 3 + index;
    return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  }).reverse();
}

function money(value: number): string {
  return formatINR(Math.round(value * 100));
}

function quantity(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 3,
  }).format(value);
}

function sourceLabel(status: Gstr9SourceStatus): string {
  switch (status) {
    case "AUTO":
      return "Available";
    case "INPUT_REQUIRED":
      return "Input required";
    default:
      return "Not available";
  }
}

function sourceClass(status: Gstr9SourceStatus): string {
  switch (status) {
    case "AUTO":
      return "border-emerald-300/50 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200";
    case "INPUT_REQUIRED":
      return "border-amber-300/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200";
    default:
      return "border-muted bg-muted/30 text-muted-foreground";
  }
}

function SourceStatus({
  label,
  status,
  actionLabel,
  onAction,
  disabled = false,
}: {
  label: string;
  status: Gstr9SourceStatus | "MANUAL" | "IMPORTED";
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  const isInput = status === "INPUT_REQUIRED";
  const isManual = status === "MANUAL";
  const isImported = status === "IMPORTED";
  const visualStatus: Gstr9SourceStatus = isManual || isImported ? "AUTO" : status;

  return (
    <div className={`rounded-md border px-3 py-2 ${sourceClass(visualStatus)}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium">{label}</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
            {visualStatus === "AUTO" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : visualStatus === "INPUT_REQUIRED" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Info className="h-4 w-4" />
            )}
            {isManual ? "Manual entry saved" : isImported ? "Imported" : sourceLabel(status as Gstr9SourceStatus)}
          </div>
        </div>
        {actionLabel && (
          <Button size="sm" variant="outline" onClick={onAction} disabled={disabled}>
            {actionLabel}
          </Button>
        )}
      </div>
      {disabled && <div className="mt-1 text-[11px] text-muted-foreground">Next input phase</div>}
    </div>
  );
}



const GSTR1_TABLE4_FIELDS: Array<[keyof Gstr9Table4, string]> = [
  ["b2b", "B2B supplies"],
  ["b2cLarge", "B2C large"],
  ["exportsWithPayment", "Exports with payment"],
  ["sezWithPayment", "SEZ with payment"],
  ["deemedExports", "Deemed exports"],
  ["advancesTaxPaid", "Advances on which tax paid"],
  ["inwardSuppliesRcm", "Inward supplies liable to RCM"],
  ["b2cOther", "B2C other"],
  ["exportsWithoutPayment", "Exports without payment"],
  ["sezWithoutPayment", "SEZ without payment"],
  ["advancesTaxAdjusted", "Advances adjusted"],
  ["otherOutwardTaxableSupplies", "Other outward taxable supplies"],
];

const GSTR1_TABLE5_FIELDS: Array<[keyof Gstr9Table5, string]> = [
  ["exportsWithoutPayment", "Exports without payment"],
  ["sezWithoutPayment", "SEZ without payment"],
  ["suppliesOnWhichTaxPayableByRecipient", "Tax payable by recipient"],
  ["exemptSupplies", "Exempt supplies"],
  ["nilRatedSupplies", "Nil-rated supplies"],
  ["nonGstSupplies", "Non-GST supplies"],
];

function emptyGstr9Table4(): Gstr9Table4 {
  return {
    b2b: emptyTaxAmount(),
    b2cLarge: emptyTaxAmount(),
    exportsWithPayment: emptyTaxAmount(),
    sezWithPayment: emptyTaxAmount(),
    deemedExports: emptyTaxAmount(),
    advancesTaxPaid: emptyTaxAmount(),
    inwardSuppliesRcm: emptyTaxAmount(),
    b2cOther: emptyTaxAmount(),
    exportsWithoutPayment: emptyTaxAmount(),
    sezWithoutPayment: emptyTaxAmount(),
    advancesTaxAdjusted: emptyTaxAmount(),
    otherOutwardTaxableSupplies: emptyTaxAmount(),
    total: emptyTaxAmount(),
  };
}

function emptyGstr9Table5(): Gstr9Table5 {
  return {
    exportsWithoutPayment: emptyTaxAmount(),
    sezWithoutPayment: emptyTaxAmount(),
    suppliesOnWhichTaxPayableByRecipient: emptyTaxAmount(),
    exemptSupplies: emptyTaxAmount(),
    nilRatedSupplies: emptyTaxAmount(),
    nonGstSupplies: emptyTaxAmount(),
    total: emptyTaxAmount(),
  };
}

function cloneTaxAmount(value: Gstr9TaxAmount): Gstr9TaxAmount {
  return { ...value };
}

function cloneTable4(value: Gstr9Table4): Gstr9Table4 {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneTaxAmount(item as Gstr9TaxAmount)]),
  ) as Gstr9Table4;
}

function cloneTable5(value: Gstr9Table5): Gstr9Table5 {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneTaxAmount(item as Gstr9TaxAmount)]),
  ) as Gstr9Table5;
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normaliseTaxAmount(value: unknown): Gstr9TaxAmount {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    taxableValue: numberValue(String(source.taxableValue ?? 0)),
    igst: numberValue(String(source.igst ?? 0)),
    cgst: numberValue(String(source.cgst ?? 0)),
    sgst: numberValue(String(source.sgst ?? 0)),
    cess: numberValue(String(source.cess ?? 0)),
  };
}

function normaliseGstr1Import(value: unknown): {
  table4: Gstr9Table4;
  table5: Gstr9Table5;
  sourceName?: string;
  sourceReference?: string;
  notes?: string;
} {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const payload = root.gstr1 && typeof root.gstr1 === "object"
    ? root.gstr1 as Record<string, unknown>
    : root;
  const sourceTable4 = payload.table4 && typeof payload.table4 === "object"
    ? payload.table4 as Record<string, unknown>
    : {};
  const sourceTable5 = payload.table5 && typeof payload.table5 === "object"
    ? payload.table5 as Record<string, unknown>
    : {};

  const table4 = emptyGstr9Table4();
  for (const [key] of GSTR1_TABLE4_FIELDS) {
    table4[key] = normaliseTaxAmount(sourceTable4[key]);
  }
  table4.total = normaliseTaxAmount(sourceTable4.total);

  const table5 = emptyGstr9Table5();
  for (const [key] of GSTR1_TABLE5_FIELDS) {
    table5[key] = normaliseTaxAmount(sourceTable5[key]);
  }
  table5.total = normaliseTaxAmount(sourceTable5.total);

  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : {};

  return {
    table4,
    table5,
    sourceName: String(metadata.sourceName ?? root.sourceName ?? "").trim() || undefined,
    sourceReference: String(metadata.sourceReference ?? root.sourceReference ?? "").trim() || undefined,
    notes: String(metadata.notes ?? root.notes ?? "").trim() || undefined,
  };
}

function TaxAmountFields({
  value,
  onChange,
}: {
  value: Gstr9TaxAmount;
  onChange: (value: Gstr9TaxAmount) => void;
}) {
  const fields: Array<[keyof Gstr9TaxAmount, string]> = [
    ["taxableValue", "Taxable"],
    ["igst", "IGST"],
    ["cgst", "CGST"],
    ["sgst", "SGST"],
    ["cess", "Cess"],
  ];

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
      {fields.map(([field, label]) => (
        <label key={field} className="space-y-1">
          <span className="text-[11px] text-muted-foreground">{label}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={value[field]}
            onChange={(event) =>
              onChange({ ...value, [field]: numberValue(event.target.value) })
            }
            className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      ))}
    </div>
  );
}

function Gstr1InputPanel({
  financialYear,
  companyId,
  existing,
  onClose,
  onSaved,
}: {
  financialYear: string;
  companyId: string;
  existing: Gstr9InputRecord | undefined;
  onClose: () => void;
  onSaved: (record: Gstr9InputRecord) => void;
}) {
  const existingGstr1 = existing?.gstr1;
  const [tab, setTab] = useState<"MANUAL" | "IMPORT">("MANUAL");
  const [table4, setTable4] = useState<Gstr9Table4>(
    () => existingGstr1 ? cloneTable4(existingGstr1.table4) : emptyGstr9Table4(),
  );
  const [table5, setTable5] = useState<Gstr9Table5>(
    () => existingGstr1 ? cloneTable5(existingGstr1.table5) : emptyGstr9Table5(),
  );
  const [sourceName, setSourceName] = useState(existingGstr1?.metadata.sourceName ?? "Filed GSTR-1");
  const [sourceReference, setSourceReference] = useState(existingGstr1?.metadata.sourceReference ?? "");
  const [notes, setNotes] = useState(existingGstr1?.metadata.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateTable4 = (field: keyof Gstr9Table4, value: Gstr9TaxAmount) => {
    setTable4((current) => ({ ...current, [field]: value }));
  };

  const updateTable5 = (field: keyof Gstr9Table5, value: Gstr9TaxAmount) => {
    setTable5((current) => ({ ...current, [field]: value }));
  };

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt: existingGstr1?.metadata.enteredAt ?? now,
        updatedAt: now,
        sourceName: sourceName.trim() || undefined,
        sourceReference: sourceReference.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const record: Gstr9InputRecord = {
        ...(existing ?? {
          id: `${companyId}:${financialYear}`,
          companyId,
          financialYear,
        }),
        gstr1: { table4, table5, metadata },
      };
      await saveGstr9InputRecord(record);
      onSaved(record);
      setMessage(`${source === "IMPORT" ? "Imported" : "Manual entry"} saved successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save GSTR-1 input.");
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const imported = normaliseGstr1Import(parsed);
      setTable4(imported.table4);
      setTable5(imported.table5);
      if (imported.sourceName) setSourceName(imported.sourceName);
      if (imported.sourceReference) setSourceReference(imported.sourceReference);
      if (imported.notes) setNotes(imported.notes);
      setTab("IMPORT");
      setMessage("JSON loaded. Review the values, then click Save imported GSTR-1.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the JSON file.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="max-h-[92vh] w-full max-w-6xl overflow-hidden shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">Filed GSTR-1 Input — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Manual entry and JSON import use the same local GSTR-9 input store.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="max-h-[calc(92vh-76px)] overflow-y-auto p-4">
          <div className="mb-4 flex gap-2 border-b pb-3">
            <Button size="sm" variant={tab === "MANUAL" ? "default" : "outline"} onClick={() => setTab("MANUAL")}>
              Manual Entry
            </Button>
            <Button size="sm" variant={tab === "IMPORT" ? "default" : "outline"} onClick={() => setTab("IMPORT")}>
              <Upload className="mr-1 h-4 w-4" /> Import JSON
            </Button>
          </div>

          {tab === "IMPORT" && (
            <div className="mb-4 rounded-md border border-dashed p-4">
              <div className="text-sm font-medium">Import GSTR-1 structured JSON</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Import a JSON containing <code>table4</code> and <code>table5</code>, or a wrapper containing <code>gstr1</code>.
              </p>
              <input
                type="file"
                accept=".json,application/json"
                className="mt-3 block text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file);
                  event.currentTarget.value = "";
                }}
              />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs font-medium">Source name</span>
              <input value={sourceName} onChange={(event) => setSourceName(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Source reference</span>
              <input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="e.g. ARN / file name" className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium">Notes</span>
              <input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" />
            </label>
          </div>

          <div className="mt-5 space-y-5">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Table 4 — Details of outward supplies and inward supplies liable to reverse charge</h3>
              <div className="space-y-2">
                {GSTR1_TABLE4_FIELDS.map(([field, label]) => (
                  <div key={field} className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium">{label}</div>
                    <TaxAmountFields value={table4[field]} onChange={(value) => updateTable4(field, value)} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Table 5 — Details of outward supplies on which tax is not payable</h3>
              <div className="space-y-2">
                {GSTR1_TABLE5_FIELDS.map(([field, label]) => (
                  <div key={field} className="rounded-md border p-3">
                    <div className="mb-2 text-xs font-medium">{label}</div>
                    <TaxAmountFields value={table5[field]} onChange={(value) => updateTable5(field, value)} />
                  </div>
                ))}
              </div>
            </section>
          </div>

          {message && <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}

          <div className="mt-5 flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")} disabled={saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : tab === "IMPORT" ? "Save imported GSTR-1" : "Save manual GSTR-1"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TotalsTable({
  rows,
}: {
  rows: Array<[string, Gstr9TaxTotals]>;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Particulars</TableHead>
            <TableHead className="text-right">Taxable value</TableHead>
            <TableHead className="text-right">IGST</TableHead>
            <TableHead className="text-right">CGST</TableHead>
            <TableHead className="text-right">SGST</TableHead>
            <TableHead className="text-right">Total tax</TableHead>
            <TableHead className="text-right">Gross value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell className="font-medium">{label}</TableCell>
              <TableCell className="text-right">{money(value.taxableValue)}</TableCell>
              <TableCell className="text-right">{money(value.igst)}</TableCell>
              <TableCell className="text-right">{money(value.cgst)}</TableCell>
              <TableCell className="text-right">{money(value.sgst)}</TableCell>
              <TableCell className="text-right">{money(value.totalTax)}</TableCell>
              <TableCell className="text-right">{money(value.grossValue)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GSTR9Page() {
  const { activeCompanyId } = useCompany();
  const [financialYear, setFinancialYear] = useState(currentFinancialYear);
  const [company, setCompany] = useState<CompanyMeta | null>(null);
  const [result, setResult] = useState<Gstr9Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputRecord, setInputRecord] = useState<Gstr9InputRecord | undefined>();
  const [gstr1Open, setGstr1Open] = useState(false);

  const years = useMemo(() => financialYearOptions(), []);

  const load = async () => {
    if (!activeCompanyId) {
      setCompany(null);
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const meta = await fetchCompanyMeta(activeCompanyId);

      if (!meta) {
        throw new Error("Company information could not be loaded.");
      }

      const built = await loadGstr9Books(
        meta,
        activeCompanyId,
        financialYear,
      );

      setCompany(meta);
      setResult(built);
    } catch (err) {
      setResult(null);
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load the GSTR-9 working paper.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!activeCompanyId) {
      setInputRecord(undefined);
      return;
    }
    void loadGstr9InputRecord(activeCompanyId, financialYear)
      .then((record) => {
        if (!cancelled) setInputRecord(record);
      })
      .catch(() => {
        if (!cancelled) setInputRecord(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, financialYear]);

  const issues = result ? validateGstr9(result) : [];
  const inputStatus = getGstr9InputStatus(inputRecord);

  const outwardRows = result
    ? [
        ["Registered taxable supplies", result.outward.registeredTaxable],
        ["Unregistered taxable supplies", result.outward.unregisteredTaxable],
        ["Zero-rated with payment", result.outward.zeroRatedWithPayment],
        ["Zero-rated without payment", result.outward.zeroRatedWithoutPayment],
        ["Deemed exports", result.outward.deemedExport],
        ["Nil-rated", result.outward.nilRated],
        ["Exempt", result.outward.exempt],
        ["Non-GST", result.outward.nonGst],
        ["Total outward supplies", result.outward.totalOutward],
      ] satisfies Array<[string, Gstr9TaxTotals]>
    : [];

  const natureRows = result
    ? [
        ["Taxable", result.natureSummary.taxable],
        ["Zero-rated with payment", result.natureSummary.zero_rated_wp],
        ["Zero-rated without payment", result.natureSummary.zero_rated_wop],
        ["Deemed exports", result.natureSummary.deemed_export],
        ["Nil-rated", result.natureSummary.nil_rated],
        ["Exempt", result.natureSummary.exempt],
        ["Non-GST", result.natureSummary.non_gst],
      ] satisfies Array<
        [
          string,
          Gstr9Result["natureSummary"][keyof Gstr9Result["natureSummary"]],
        ]
      >
    : [];

  return (
    <div className="space-y-3">
      <Card className="print:hidden">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Financial year</Label>
              <Select value={financialYear} onValueChange={setFinancialYear}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {years.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading || !activeCompanyId}
              >
                <RefreshCw
                  className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
                disabled={!result}
              >
                <Printer className="mr-1 h-4 w-4" />
                Print
              </Button>
            </div>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Annual period:{" "}
            <strong>
              {result?.period.from ?? financialYearRange(financialYear).from}
            </strong>{" "}
            to{" "}
            <strong>
              {result?.period.to ?? financialYearRange(financialYear).to}
            </strong>
          </p>
        </CardContent>
      </Card>

      {loading && (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading GSTR-9 books data…
          </CardContent>
        </Card>
      )}

      {error && !loading && (
        <Card>
          <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <div className="font-medium">GSTR-9 could not be loaded</div>
              <div className="mt-1">{error}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {!activeCompanyId && !loading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Select or open a company before loading the GSTR-9 working paper.
          </CardContent>
        </Card>
      )}

      {result && company && !loading && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                GSTR-9 — Annual Return Working Paper
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Company</div>
                <div className="font-semibold">{company.name}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">GSTIN</div>
                <div className="font-semibold">
                  {company.gstin || "Not available"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Financial year
                </div>
                <div className="font-semibold">{result.period.financialYear}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Source status</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <SourceStatus
                label="Books / outward supplies"
                status={result.sourceInfo.outwardSupplies}
              />
              <SourceStatus
                label="Filed GSTR-1"
                status={inputStatus.gstr1}
                actionLabel="Enter / Import"
                onAction={() => setGstr1Open(true)}
              />
              <SourceStatus
                label="Filed GSTR-3B"
                status={result.sourceInfo.filedGstr3b}
                actionLabel="Next"
                disabled
              />
              <SourceStatus
                label="GSTR-2B"
                status={result.sourceInfo.gstr2b}
                actionLabel="Next"
                disabled
              />
              <SourceStatus
                label="ITC tables"
                status={result.sourceInfo.itcTables}
                actionLabel="Next"
                disabled
              />
              <SourceStatus
                label="Tax payment data"
                status={result.sourceInfo.taxPaymentTable}
                actionLabel="Next"
                disabled
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Books-derived outward supplies
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TotalsTable rows={outwardRows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Nature-wise summary</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nature</TableHead>
                      <TableHead className="text-right">Vouchers</TableHead>
                      <TableHead className="text-right">Taxable value</TableHead>
                      <TableHead className="text-right">Total tax</TableHead>
                      <TableHead className="text-right">Gross value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {natureRows.map(([label, value]) => (
                      <TableRow key={label}>
                        <TableCell className="font-medium">{label}</TableCell>
                        <TableCell className="text-right">
                          {value.voucherCount}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(value.taxableValue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(value.totalTax)}
                        </TableCell>
                        <TableCell className="text-right">
                          {money(value.grossValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                HSN / SAC summary ({result.hsn.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {result.hsn.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  No HSN/SAC rows are available from the books for this period.
                </div>
              ) : (
                <div className="max-h-[520px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>HSN/SAC</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>UQC</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Taxable</TableHead>
                        <TableHead className="text-right">IGST</TableHead>
                        <TableHead className="text-right">CGST</TableHead>
                        <TableHead className="text-right">SGST</TableHead>
                        <TableHead className="text-right">Total tax</TableHead>
                        <TableHead className="text-right">Total value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.hsn.map((row) => (
                        <TableRow
                          key={`${row.hsn}|${row.uqc}|${row.description}`}
                        >
                          <TableCell className="font-medium">{row.hsn}</TableCell>
                          <TableCell className="max-w-[260px]">
                            {row.description || "—"}
                          </TableCell>
                          <TableCell>{row.uqc}</TableCell>
                          <TableCell className="text-right">
                            {quantity(row.quantity)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(row.taxableValue)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(row.igst)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(row.cgst)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(row.sgst)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(row.totalTax)}
                          </TableCell>
                          <TableCell className="text-right">
                            {money(row.totalValue)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Books reconciliation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Particulars</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell>Books outward taxable value</TableCell>
                      <TableCell className="text-right">
                        {money(result.reconciliation.booksOutwardTaxableValue)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Component taxable value</TableCell>
                      <TableCell className="text-right">
                        {money(result.reconciliation.componentTaxableValue)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Taxable difference</TableCell>
                      <TableCell className="text-right">
                        {money(result.reconciliation.taxableDifference)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Books outward tax</TableCell>
                      <TableCell className="text-right">
                        {money(result.reconciliation.booksOutwardTax)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Component tax</TableCell>
                      <TableCell className="text-right">
                        {money(result.reconciliation.componentTax)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Tax difference</TableCell>
                      <TableCell className="text-right">
                        {money(result.reconciliation.taxDifference)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-semibold">
                        Internal status
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            result.reconciliation.balanced
                              ? "font-semibold text-emerald-700 dark:text-emerald-300"
                              : "font-semibold text-destructive"
                          }
                        >
                          {result.reconciliation.balanced
                            ? "Balanced"
                            : "Investigate difference"}
                        </span>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Validation and filing-readiness notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {issues.length === 0 ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-300/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  Internal validation checks passed.
                </div>
              ) : (
                <div className="space-y-2">
                  {issues.map((issue) => (
                    <div
                      key={`${issue.code}-${issue.message}`}
                      className={`rounded-md border px-3 py-2 text-sm ${
                        issue.level === "error"
                          ? "border-destructive/40 bg-destructive/5 text-destructive"
                          : "border-amber-300/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {issue.level === "error" ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <div>
                          <div className="text-xs font-semibold uppercase">
                            {issue.level}
                          </div>
                          <div className="mt-0.5">{issue.message}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                This Phase 1 screen is a books-derived working paper. Filed
                GSTR-1, GSTR-3B, GSTR-2B, ITC and tax-payment figures are not
                fabricated from accounting vouchers and will be added through
                later input/import phases.
              </div>
            </CardContent>
          </Card>

          {result.warnings.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Engine warnings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.warnings.map((warning) => (
                  <div
                    key={warning}
                    className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {gstr1Open && activeCompanyId && (
            <Gstr1InputPanel
              financialYear={financialYear}
              companyId={activeCompanyId}
              existing={inputRecord}
              onClose={() => setGstr1Open(false)}
              onSaved={(record) => {
                setInputRecord(record);
                setGstr1Open(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
