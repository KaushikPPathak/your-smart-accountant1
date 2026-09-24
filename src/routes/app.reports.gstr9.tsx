import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
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
import { exportGstr9Excel } from "@/lib/gstr9-export";

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
}: {
  label: string;
  status: Gstr9SourceStatus;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 ${sourceClass(status)}`}>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
        {status === "AUTO" ? (
          <CheckCircle2 className="h-4 w-4" />
        ) : status === "INPUT_REQUIRED" ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <Info className="h-4 w-4" />
        )}
        {sourceLabel(status)}
      </div>
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
    void load();
  }, [activeCompanyId, financialYear]);

  const issues = result ? validateGstr9(result) : [];

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
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (result) {
                    void exportGstr9Excel(result);
                  }
                }}
                disabled={!result || loading}
              >
                <Download className="mr-1 h-4 w-4" />
                Excel
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
                status={result.sourceInfo.filedGstr1}
              />
              <SourceStatus
                label="Filed GSTR-3B"
                status={result.sourceInfo.filedGstr3b}
              />
              <SourceStatus
                label="GSTR-2B"
                status={result.sourceInfo.gstr2b}
              />
              <SourceStatus
                label="ITC tables"
                status={result.sourceInfo.itcTables}
              />
              <SourceStatus
                label="Tax payment data"
                status={result.sourceInfo.taxPaymentTable}
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
        </>
      )}
    </div>
  );
}
