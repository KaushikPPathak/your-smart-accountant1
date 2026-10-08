import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Printer,
  RefreshCw,
  Save,
  Upload,
  X,
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
import { Input } from "@/components/ui/input";
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
import {
  emptyTaxAmount,
  getGstr9InputStatus,
  type Gstr9InputMetadata,
  type Gstr9InputRecord,
  type Gstr9InputSource,
  type Gstr9Table4,
  type Gstr9Table5,
  type Gstr9TaxAmount,
  type Gstr9Table6,
  type Gstr9Table7,
  type Gstr9Table8,
  type Gstr9Gstr3bPeriod,
  type Gstr9Gstr2bPeriod,
  type Gstr9TaxPaid,
  type Gstr9TaxPaidRow,
} from "@/lib/gstr9-inputs";
import {
  loadGstr9InputRecord,
  saveGstr9InputRecord,
} from "@/lib/gstr9-input-store";
import { analyseGstr1ExcelBuffer } from "@/lib/gstr1-excel-import";
import { analyseGstr3bExcelBuffer } from "@/lib/gstr3b-excel-import";
import { parseGstr9PurchaseRegisterExcel, parseGstr9PurchaseRegisterJson, type Gstr9PurchaseRegisterImport } from "@/lib/gstr9-purchase-register";
import type { Gstr2bExcelLine } from "@/lib/gstr2b-excel-import";
import {
  buildGstr9ItcReconciliation,
  gstr9ItcLineKey,
  setAllEligibleGstr9ItcInclusion,
  type Gstr9ItcReconciliationLine,
} from "@/lib/gstr9-itc-reconciliation";
import {
  latestImport as latestGstr2bImport,
  loadImportLines as loadGstr2bImportLines,
  loadLocalPurchases,
} from "@/lib/gstr2b-local-store";

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
  return {
    b2b: cloneTaxAmount(value.b2b),
    b2cLarge: cloneTaxAmount(value.b2cLarge),
    exportsWithPayment: cloneTaxAmount(value.exportsWithPayment),
    sezWithPayment: cloneTaxAmount(value.sezWithPayment),
    deemedExports: cloneTaxAmount(value.deemedExports),
    advancesTaxPaid: cloneTaxAmount(value.advancesTaxPaid),
    inwardSuppliesRcm: cloneTaxAmount(value.inwardSuppliesRcm),
    b2cOther: cloneTaxAmount(value.b2cOther),
    exportsWithoutPayment: cloneTaxAmount(value.exportsWithoutPayment),
    sezWithoutPayment: cloneTaxAmount(value.sezWithoutPayment),
    advancesTaxAdjusted: cloneTaxAmount(value.advancesTaxAdjusted),
    otherOutwardTaxableSupplies: cloneTaxAmount(value.otherOutwardTaxableSupplies),
    total: cloneTaxAmount(value.total),
  };
}

function cloneTable5(value: Gstr9Table5): Gstr9Table5 {
  return {
    exportsWithoutPayment: cloneTaxAmount(value.exportsWithoutPayment),
    sezWithoutPayment: cloneTaxAmount(value.sezWithoutPayment),
    suppliesOnWhichTaxPayableByRecipient: cloneTaxAmount(value.suppliesOnWhichTaxPayableByRecipient),
    exemptSupplies: cloneTaxAmount(value.exemptSupplies),
    nilRatedSupplies: cloneTaxAmount(value.nilRatedSupplies),
    nonGstSupplies: cloneTaxAmount(value.nonGstSupplies),
    total: cloneTaxAmount(value.total),
  };
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

type Gstr9TaxPaidTaxKey = "igst" | "cgst" | "sgst" | "cess";
type Gstr9TaxPaidOtherKey = "interest" | "lateFee" | "penalty" | "others";
type Gstr9TaxPaidRowField = "taxPayable" | "paidThroughCash" | "paidThroughItc";

function emptyGstr9TaxPaidRow(): Gstr9TaxPaid["igst"] {
  return {
    taxPayable: 0,
    paidThroughCash: 0,
    paidThroughItc: 0,
  };
}

function emptyGstr9TaxPaid(): Gstr9TaxPaid {
  return {
    igst: emptyGstr9TaxPaidRow(),
    cgst: emptyGstr9TaxPaidRow(),
    sgst: emptyGstr9TaxPaidRow(),
    cess: emptyGstr9TaxPaidRow(),
    interest: 0,
    lateFee: 0,
    penalty: 0,
    others: 0,
  };
}

function taxPaidRowTotal(row: Gstr9TaxPaid["igst"]): number {
  return row.paidThroughCash + row.paidThroughItc;
}

function taxPaidRowHasValue(row: Gstr9TaxPaid["igst"]): boolean {
  return row.taxPayable !== 0 || taxPaidRowTotal(row) !== 0;
}

function normaliseGstr9TaxPaidRow(value: unknown): Gstr9TaxPaid["igst"] {
  if (typeof value === "number") {
    return {
      taxPayable: numberValue(String(value)),
      paidThroughCash: 0,
      paidThroughItc: 0,
    };
  }

  const row = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};

  return {
    taxPayable: numberValue(String(row.taxPayable ?? 0)),
    paidThroughCash: numberValue(String(row.paidThroughCash ?? 0)),
    paidThroughItc: numberValue(String(row.paidThroughItc ?? 0)),
  };
}

function emptyGstr3bPeriod(period: string): Gstr9Gstr3bPeriod {
  return {
    period,
    outwardTax: emptyTaxAmount(),
    itc: {
      table4A1ImportOfGoods: 0,
      table4A2ImportOfServices: 0,
      table4A3Rcm: 0,
      table4A4Isd: 0,
      table4A5Other: 0,
      totalItcAvailed: 0,
    },
    itcReversal: {
      rule38: 0,
      rule42: 0,
      rule43: 0,
      section17_5: 0,
      other: 0,
      total: 0,
    },
    taxPaid: emptyGstr9TaxPaid(),
  };
}

function gstr3bPeriodsForFinancialYear(financialYear: string): string[] {
  const startYear = Number(financialYear.slice(0, 4));
  if (!Number.isFinite(startYear)) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const month = (index + 3) % 12;
    const year = startYear + (index >= 9 ? 1 : 0);
    return new Date(year, month, 1).toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });
}

function cloneGstr3bPeriod(value: Gstr9Gstr3bPeriod): Gstr9Gstr3bPeriod {
  return {
    period: value.period,
    outwardTax: { ...value.outwardTax },
    itc: { ...value.itc },
    itcReversal: { ...value.itcReversal },
    taxPaid: { ...value.taxPaid },
  };
}

function normaliseGstr3bPeriod(value: unknown, fallbackPeriod: string): Gstr9Gstr3bPeriod {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const outward = normaliseTaxAmount(root.outwardTax);
  const itcSource = root.itc && typeof root.itc === "object" ? root.itc as Record<string, unknown> : {};
  const reversalSource = root.itcReversal && typeof root.itcReversal === "object" ? root.itcReversal as Record<string, unknown> : {};
  const taxSource = root.taxPaid && typeof root.taxPaid === "object" ? root.taxPaid as Record<string, unknown> : {};
  const n = (source: Record<string, unknown>, key: string) => numberValue(String(source[key] ?? 0));

  const itc = {
    table4A1ImportOfGoods: n(itcSource, "table4A1ImportOfGoods"),
    table4A2ImportOfServices: n(itcSource, "table4A2ImportOfServices"),
    table4A3Rcm: n(itcSource, "table4A3Rcm"),
    table4A4Isd: n(itcSource, "table4A4Isd"),
    table4A5Other: n(itcSource, "table4A5Other"),
    totalItcAvailed: 0,
  };
  itc.totalItcAvailed =
    itc.table4A1ImportOfGoods +
    itc.table4A2ImportOfServices +
    itc.table4A3Rcm +
    itc.table4A4Isd +
    itc.table4A5Other;

  const itcReversal = {
    rule38: n(reversalSource, "rule38"),
    rule42: n(reversalSource, "rule42"),
    rule43: n(reversalSource, "rule43"),
    section17_5: n(reversalSource, "section17_5"),
    other: n(reversalSource, "other"),
    total: 0,
  };
  itcReversal.total =
    itcReversal.rule38 +
    itcReversal.rule42 +
    itcReversal.rule43 +
    itcReversal.section17_5 +
    itcReversal.other;

  return {
    period: String(root.period ?? fallbackPeriod),
    outwardTax: outward,
    itc,
    itcReversal,
    taxPaid: {
      igst: normaliseGstr9TaxPaidRow(taxSource.igst),
      cgst: normaliseGstr9TaxPaidRow(taxSource.cgst),
      sgst: normaliseGstr9TaxPaidRow(taxSource.sgst),
      cess: normaliseGstr9TaxPaidRow(taxSource.cess),
      interest: n(taxSource, "interest"),
      lateFee: n(taxSource, "lateFee"),
      penalty: n(taxSource, "penalty"),
      others: n(taxSource, "others"),
    },
  };
}

function normaliseGstr3bImport(value: unknown, financialYear: string): {
  periods: Gstr9Gstr3bPeriod[];
  sourceName?: string;
  sourceReference?: string;
  notes?: string;
} {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const payload = root.gstr3b && typeof root.gstr3b === "object"
    ? root.gstr3b as Record<string, unknown>
    : root;
  const defaults = gstr3bPeriodsForFinancialYear(financialYear);
  const sourcePeriods = Array.isArray(payload.periods) ? payload.periods : [];
  const periods = defaults.map((period, index) =>
    normaliseGstr3bPeriod(sourcePeriods[index], period),
  );
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : {};

  return {
    periods,
    sourceName: String(metadata.sourceName ?? root.sourceName ?? "").trim() || undefined,
    sourceReference: String(metadata.sourceReference ?? root.sourceReference ?? "").trim() || undefined,
    notes: String(metadata.notes ?? root.notes ?? "").trim() || undefined,
  };
}


function gstr2bPeriodsForFinancialYear(financialYear: string): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  const startYear = match ? Number(match[1]) : new Date().getFullYear();
  return Array.from({ length: 12 }, (_, index) => {
    const year = index < 9 ? startYear : startYear + 1;
    const month = index < 9 ? index + 4 : index - 8;
    return new Date(year, month - 1, 1).toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });
}

function emptyGstr2bPeriod(period: string): Gstr9Gstr2bPeriod {
  return {
    period,
    itcAvailable: {
      importOfGoods: 0,
      importOfServices: 0,
      reverseCharge: 0,
      isd: 0,
      otherRegisteredSupplies: 0,
      total: 0,
    },
    itcNotAvailable: {
      section16_4: 0,
      posRestriction: 0,
      other: 0,
      total: 0,
    },
  };
}

function cloneGstr2bPeriod(period: Gstr9Gstr2bPeriod): Gstr9Gstr2bPeriod {
  return {
    period: period.period,
    itcAvailable: { ...period.itcAvailable },
    itcNotAvailable: { ...period.itcNotAvailable },
  };
}

function normaliseGstr2bPeriod(value: unknown, fallbackPeriod: string): Gstr9Gstr2bPeriod {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const available = root.itcAvailable && typeof root.itcAvailable === "object"
    ? root.itcAvailable as Record<string, unknown>
    : {};
  const notAvailable = root.itcNotAvailable && typeof root.itcNotAvailable === "object"
    ? root.itcNotAvailable as Record<string, unknown>
    : {};
  const n = (source: Record<string, unknown>, key: string) => {
    const value = Number(source[key] ?? 0);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  const importOfGoods = n(available, "importOfGoods");
  const importOfServices = n(available, "importOfServices");
  const reverseCharge = n(available, "reverseCharge");
  const isd = n(available, "isd");
  const otherRegisteredSupplies = n(available, "otherRegisteredSupplies");
  const section16_4 = n(notAvailable, "section16_4");
  const posRestriction = n(notAvailable, "posRestriction");
  const other = n(notAvailable, "other");
  return {
    period: String(root.period ?? fallbackPeriod),
    itcAvailable: {
      importOfGoods,
      importOfServices,
      reverseCharge,
      isd,
      otherRegisteredSupplies,
      total: importOfGoods + importOfServices + reverseCharge + isd + otherRegisteredSupplies,
    },
    itcNotAvailable: {
      section16_4,
      posRestriction,
      other,
      total: section16_4 + posRestriction + other,
    },
  };
}

function normaliseGstr2bImport(value: unknown, financialYear: string): {
  periods: Gstr9Gstr2bPeriod[];
  sourceName?: string;
  sourceReference?: string;
  notes?: string;
} {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const payload = root.gstr2b && typeof root.gstr2b === "object"
    ? root.gstr2b as Record<string, unknown>
    : root;
  const defaults = gstr2bPeriodsForFinancialYear(financialYear);
  const sourcePeriods = Array.isArray(payload.periods) ? payload.periods : [];
  const periods = defaults.map((period, index) => normaliseGstr2bPeriod(sourcePeriods[index], period));
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata as Record<string, unknown>
    : {};
  return {
    periods,
    sourceName: String(metadata.sourceName ?? root.sourceName ?? "").trim() || undefined,
    sourceReference: String(metadata.sourceReference ?? root.sourceReference ?? "").trim() || undefined,
    notes: String(metadata.notes ?? root.notes ?? "").trim() || undefined,
  };
}

const GSTR2B_AVAILABLE_FIELDS: Array<[keyof Gstr9Gstr2bPeriod["itcAvailable"], string]> = [
  ["importOfGoods", "Import of goods"],
  ["importOfServices", "Import of services"],
  ["reverseCharge", "Reverse charge"],
  ["isd", "ISD"],
  ["otherRegisteredSupplies", "Other registered supplies"],
];

const GSTR2B_NOT_AVAILABLE_FIELDS: Array<[keyof Gstr9Gstr2bPeriod["itcNotAvailable"], string]> = [
  ["section16_4", "Section 16(4)"],
  ["posRestriction", "Place-of-supply restriction"],
  ["other", "Other ITC not available"],
];

const GSTR3B_ITC_FIELDS: Array<[keyof Gstr9Gstr3bPeriod["itc"], string]> = [
  ["table4A1ImportOfGoods", "4A(1) Import of goods"],
  ["table4A2ImportOfServices", "4A(2) Import of services"],
  ["table4A3Rcm", "4A(3) RCM"],
  ["table4A4Isd", "4A(4) ISD"],
  ["table4A5Other", "4A(5) Other ITC"],
];

const GSTR3B_REVERSAL_FIELDS: Array<[keyof Gstr9Gstr3bPeriod["itcReversal"], string]> = [
  ["rule38", "Rule 38"],
  ["rule42", "Rule 42"],
  ["rule43", "Rule 43"],
  ["section17_5", "Section 17(5)"],
  ["other", "Other reversals"],
];

const GSTR3B_TAX_PAID_TAX_FIELDS: Array<[Gstr9TaxPaidTaxKey, string]> = [
  ["igst", "IGST"],
  ["cgst", "CGST"],
  ["sgst", "SGST"],
  ["cess", "Cess"],
];

const GSTR3B_TAX_PAID_OTHER_FIELDS: Array<[Gstr9TaxPaidOtherKey, string]> = [
  ["interest", "Interest"],
  ["lateFee", "Late fee"],
  ["penalty", "Penalty"],
  ["others", "Others"],
];


function Gstr3bReviewSummary({ periods }: { periods: Gstr9Gstr3bPeriod[] }) {
  const totals = periods.reduce(
    (acc, period) => ({
      taxableValue: acc.taxableValue + period.outwardTax.taxableValue,
      igst: acc.igst + period.outwardTax.igst,
      cgst: acc.cgst + period.outwardTax.cgst,
      sgst: acc.sgst + period.outwardTax.sgst,
      cess: acc.cess + period.outwardTax.cess,
      itc: acc.itc + period.itc.totalItcAvailed,
      reversal: acc.reversal + period.itcReversal.total,
      taxPaid:
        acc.taxPaid +
        taxPaidRowTotal(period.taxPaid.igst) +
        taxPaidRowTotal(period.taxPaid.cgst) +
        taxPaidRowTotal(period.taxPaid.sgst) +
        taxPaidRowTotal(period.taxPaid.cess),
      interest: acc.interest + period.taxPaid.interest,
      lateFee: acc.lateFee + period.taxPaid.lateFee,
      penalty: acc.penalty + period.taxPaid.penalty,
      others: acc.others + period.taxPaid.others,
    }),
    {
      taxableValue: 0,
      igst: 0,
      cgst: 0,
      sgst: 0,
      cess: 0,
      itc: 0,
      reversal: 0,
      taxPaid: 0,
      interest: 0,
      lateFee: 0,
      penalty: 0,
      others: 0,
    },
  );

  const enteredMonths = periods.filter((period) =>
    period.outwardTax.taxableValue !== 0 ||
    period.outwardTax.igst !== 0 ||
    period.outwardTax.cgst !== 0 ||
    period.outwardTax.sgst !== 0 ||
    period.outwardTax.cess !== 0 ||
    period.itc.totalItcAvailed !== 0 ||
    period.itcReversal.total !== 0 ||
    taxPaidRowHasValue(period.taxPaid.igst) ||
    taxPaidRowHasValue(period.taxPaid.cgst) ||
    taxPaidRowHasValue(period.taxPaid.sgst) ||
    taxPaidRowHasValue(period.taxPaid.cess) ||
    period.taxPaid.interest !== 0 ||
    period.taxPaid.lateFee !== 0 ||
    period.taxPaid.penalty !== 0 ||
    period.taxPaid.others !== 0,
  ).length;

  return (
    <section className="mt-5 rounded-md border">
      <div className="border-b bg-muted/20 px-4 py-3">
        <div className="text-sm font-semibold">Review before saving</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {enteredMonths} of {periods.length} months contain entered values. Check these totals before saving.
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Particulars</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">IGST</TableHead>
              <TableHead className="text-right">CGST</TableHead>
              <TableHead className="text-right">SGST</TableHead>
              <TableHead className="text-right">Cess</TableHead>
              <TableHead className="text-right">ITC</TableHead>
              <TableHead className="text-right">Reversal</TableHead>
              <TableHead className="text-right">GST paid</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((period) => (
              <TableRow key={period.period}>
                <TableCell className="font-medium">{period.period}</TableCell>
                <TableCell className="text-right">{money(period.outwardTax.taxableValue)}</TableCell>
                <TableCell className="text-right">{money(period.outwardTax.igst)}</TableCell>
                <TableCell className="text-right">{money(period.outwardTax.cgst)}</TableCell>
                <TableCell className="text-right">{money(period.outwardTax.sgst)}</TableCell>
                <TableCell className="text-right">{money(period.outwardTax.cess)}</TableCell>
                <TableCell className="text-right">{money(period.itc.totalItcAvailed)}</TableCell>
                <TableCell className="text-right">{money(period.itcReversal.total)}</TableCell>
                <TableCell className="text-right">{money(
                    taxPaidRowTotal(period.taxPaid.igst) +
                    taxPaidRowTotal(period.taxPaid.cgst) +
                    taxPaidRowTotal(period.taxPaid.sgst) +
                    taxPaidRowTotal(period.taxPaid.cess),
                  )}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">{money(totals.taxableValue)}</TableCell>
              <TableCell className="text-right">{money(totals.igst)}</TableCell>
              <TableCell className="text-right">{money(totals.cgst)}</TableCell>
              <TableCell className="text-right">{money(totals.sgst)}</TableCell>
              <TableCell className="text-right">{money(totals.cess)}</TableCell>
              <TableCell className="text-right">{money(totals.itc)}</TableCell>
              <TableCell className="text-right">{money(totals.reversal)}</TableCell>
              <TableCell className="text-right">{money(totals.taxPaid)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 border-t p-3 text-xs sm:grid-cols-4">
        <div><span className="text-muted-foreground">Interest:</span> <strong>{money(totals.interest)}</strong></div>
        <div><span className="text-muted-foreground">Late fee:</span> <strong>{money(totals.lateFee)}</strong></div>
        <div><span className="text-muted-foreground">Penalty:</span> <strong>{money(totals.penalty)}</strong></div>
        <div><span className="text-muted-foreground">Other payments:</span> <strong>{money(totals.others)}</strong></div>
      </div>
    </section>
  );
}


function Gstr2bReviewSummary({ periods }: { periods: Gstr9Gstr2bPeriod[] }) {
  const totals = periods.reduce(
    (acc, period) => ({
      importOfGoods: acc.importOfGoods + period.itcAvailable.importOfGoods,
      importOfServices: acc.importOfServices + period.itcAvailable.importOfServices,
      reverseCharge: acc.reverseCharge + period.itcAvailable.reverseCharge,
      isd: acc.isd + period.itcAvailable.isd,
      otherRegisteredSupplies: acc.otherRegisteredSupplies + period.itcAvailable.otherRegisteredSupplies,
      available: acc.available + period.itcAvailable.total,
      section16_4: acc.section16_4 + period.itcNotAvailable.section16_4,
      posRestriction: acc.posRestriction + period.itcNotAvailable.posRestriction,
      otherNotAvailable: acc.otherNotAvailable + period.itcNotAvailable.other,
      notAvailable: acc.notAvailable + period.itcNotAvailable.total,
    }),
    {
      importOfGoods: 0,
      importOfServices: 0,
      reverseCharge: 0,
      isd: 0,
      otherRegisteredSupplies: 0,
      available: 0,
      section16_4: 0,
      posRestriction: 0,
      otherNotAvailable: 0,
      notAvailable: 0,
    },
  );

  return (
    <section className="rounded-md border bg-muted/20 p-4">
      <h3 className="text-sm font-semibold">Annual GSTR-2B review</h3>
      <p className="mt-1 text-xs text-muted-foreground">Review the April-to-March totals before saving.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Import of goods", totals.importOfGoods],
          ["Import of services", totals.importOfServices],
          ["Reverse charge", totals.reverseCharge],
          ["ISD", totals.isd],
          ["Other registered supplies", totals.otherRegisteredSupplies],
          ["Total ITC available", totals.available],
          ["Section 16(4)", totals.section16_4],
          ["POS restriction", totals.posRestriction],
          ["Other ITC not available", totals.otherNotAvailable],
          ["Total ITC not available", totals.notAvailable],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md border bg-background px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="mt-1 text-sm font-semibold text-right">{money(Number(value))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Gstr2bInputPanel({
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
  const existingGstr2b = existing?.gstr2b;
  const [tab, setTab] = useState<"MANUAL" | "IMPORT">("MANUAL");
  const [periods, setPeriods] = useState<Gstr9Gstr2bPeriod[]>(() => {
    const defaults = gstr2bPeriodsForFinancialYear(financialYear);
    if (existingGstr2b?.periods?.length) {
      return defaults.map((period, index) => existingGstr2b.periods[index]
        ? cloneGstr2bPeriod(existingGstr2b.periods[index])
        : emptyGstr2bPeriod(period));
    }
    return defaults.map(emptyGstr2bPeriod);
  });
  const [sourceName, setSourceName] = useState(existingGstr2b?.metadata.sourceName ?? "GSTR-2B");
  const [sourceReference, setSourceReference] = useState(existingGstr2b?.metadata.sourceReference ?? "");
  const [notes, setNotes] = useState(existingGstr2b?.metadata.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updatePeriod = (index: number, updater: (current: Gstr9Gstr2bPeriod) => Gstr9Gstr2bPeriod) => {
    setPeriods((current) => current.map((period, periodIndex) => periodIndex === index ? updater(period) : period));
  };

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt: existingGstr2b?.metadata.enteredAt ?? now,
        updatedAt: now,
        sourceName: sourceName.trim() || undefined,
        sourceReference: sourceReference.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const record: Gstr9InputRecord = {
        ...(existing ?? { id: `${companyId}:${financialYear}`, companyId, financialYear }),
        gstr2b: { periods, metadata },
      };
      await saveGstr9InputRecord(record);
      onSaved(record);
      setMessage(`${source === "IMPORT" ? "Imported" : "Manual entry"} saved successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save GSTR-2B input.");
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const imported = normaliseGstr2bImport(parsed, financialYear);
      setPeriods(imported.periods);
      if (imported.sourceName) setSourceName(imported.sourceName);
      if (imported.sourceReference) setSourceReference(imported.sourceReference);
      if (imported.notes) setNotes(imported.notes);
      setTab("IMPORT");
      setMessage("JSON loaded. Review the values, then click Save imported GSTR-2B.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the JSON file.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="flex h-[calc(100vh-32px)] w-full max-w-7xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">GSTR-2B Input — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Enter or import monthly GSTR-2B figures. The input is kept separate from GSTR-3B ITC claimed.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <div className="mb-4 flex shrink-0 gap-2 border-b pb-3">
            <Button size="sm" variant={tab === "MANUAL" ? "default" : "outline"} onClick={() => setTab("MANUAL")}>Manual Entry</Button>
            <Button size="sm" variant={tab === "IMPORT" ? "default" : "outline"} onClick={() => setTab("IMPORT")}><Upload className="mr-1 h-4 w-4" /> Import JSON</Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {tab === "IMPORT" && (
              <div className="mb-4 rounded-md border border-dashed p-4">
                <div className="text-sm font-medium">Import GSTR-2B structured JSON</div>
                <p className="mt-1 text-xs text-muted-foreground">Import a JSON containing a <code>periods</code> array, or a wrapper containing <code>gstr2b.periods</code>. Periods are matched April-to-March.</p>
                <input type="file" accept=".json,application/json" className="mt-3 block text-sm" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importJson(file); event.currentTarget.value = ""; }} />
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1"><span className="text-xs font-medium">Source name</span><input value={sourceName} onChange={(event) => setSourceName(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Source reference</span><input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} placeholder="e.g. downloaded file name" className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></label>
            </div>

            <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"><strong>Important:</strong> GSTR-2B is the static auto-drafted ITC statement. These figures are stored separately from GSTR-3B ITC claimed so differences can be reviewed later.</div>

            <div className="mt-5 space-y-3">
              {periods.map((period, index) => (
                <details key={`${period.period}-${index}`} open={index === 0} className="rounded-md border">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{period.period}</summary>
                  <div className="space-y-5 border-t p-4">
                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ITC available</h3>
                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                        {GSTR2B_AVAILABLE_FIELDS.map(([field, label]) => (
                          <label key={field} className="space-y-1"><span className="text-[11px] text-muted-foreground">{label}</span><input type="number" min="0" step="0.01" value={period.itcAvailable[field]} onChange={(event) => updatePeriod(index, (current) => { const itcAvailable = { ...current.itcAvailable, [field]: numberValue(event.target.value) }; itcAvailable.total = itcAvailable.importOfGoods + itcAvailable.importOfServices + itcAvailable.reverseCharge + itcAvailable.isd + itcAvailable.otherRegisteredSupplies; return { ...current, itcAvailable }; })} className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs" /></label>
                        ))}
                      </div>
                      <div className="mt-2 text-right text-xs font-semibold">Total ITC available: {money(period.itcAvailable.total)}</div>
                    </section>

                    <section>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ITC not available</h3>
                      <div className="grid gap-2 md:grid-cols-3">
                        {GSTR2B_NOT_AVAILABLE_FIELDS.map(([field, label]) => (
                          <label key={field} className="space-y-1"><span className="text-[11px] text-muted-foreground">{label}</span><input type="number" min="0" step="0.01" value={period.itcNotAvailable[field]} onChange={(event) => updatePeriod(index, (current) => { const itcNotAvailable = { ...current.itcNotAvailable, [field]: numberValue(event.target.value) }; itcNotAvailable.total = itcNotAvailable.section16_4 + itcNotAvailable.posRestriction + itcNotAvailable.other; return { ...current, itcNotAvailable }; })} className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs" /></label>
                        ))}
                      </div>
                      <div className="mt-2 text-right text-xs font-semibold">Total ITC not available: {money(period.itcNotAvailable.total)}</div>
                    </section>
                  </div>
                </details>
              ))}
            </div>

            <div className="mt-5"><Gstr2bReviewSummary periods={periods} /></div>

            {message && <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}
          </div>

          <div className="mt-4 shrink-0 flex justify-end gap-2 border-t bg-background pb-2 pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")} disabled={saving}><Save className="mr-1 h-4 w-4" />{saving ? "Saving…" : tab === "IMPORT" ? "Save imported GSTR-2B" : "Save manual GSTR-2B"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Gstr9ItcInputPanel({
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
  const existingItc = existing?.itcTables;

  const emptyTable6 = (): Gstr9Table6 => ({
    importOfGoods: 0,
    importOfServices: 0,
    inwardSuppliesRcm: 0,
    inwardSuppliesIsd: 0,
    allOtherItc: 0,
    totalItcAvailed: 0,
    precedingFinancialYearItc: 0,
  });

  const emptyTable7 = (): Gstr9Table7 => ({
    rule38: 0,
    rule39: 0,
    rule42: 0,
    rule43: 0,
    section17_5: 0,
    reversalUnderRule37: 0,
    reversalUnderRule37A: 0,
    otherReversals: 0,
    total: 0,
  });

  const emptyTable8 = (): Gstr9Table8 => ({
    itcAsPerGstr2bTable8A: 0,
    itcAsPerBooks: 0,
    creditAvailableButNotAvailed: 0,
    creditAvailableIneligible: 0,
    creditIneligibleUnderSection16_4: 0,
    totalOtherItc: 0,
  });

  const [table6, setTable6] = useState<Gstr9Table6>(
    () => existingItc?.table6
      ? { ...existingItc.table6 }
      : emptyTable6(),
  );

  const [table7, setTable7] = useState<Gstr9Table7>(
    () => existingItc?.table7
      ? { ...existingItc.table7 }
      : emptyTable7(),
  );

  const [table8, setTable8] = useState<Gstr9Table8>(
    () => existingItc?.table8
      ? { ...existingItc.table8 }
      : emptyTable8(),
  );

  const [tab, setTab] = useState<"MANUAL" | "IMPORT">("MANUAL");
  const [sourceName, setSourceName] = useState(
    existingItc?.metadata.sourceName ?? "ITC Tables 6-8",
  );
  const [sourceReference, setSourceReference] = useState(
    existingItc?.metadata.sourceReference ?? "",
  );
  const [notes, setNotes] = useState(
    existingItc?.metadata.notes ?? "",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const numberValue = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const calculateTotals = (
    next6: Gstr9Table6,
    next7: Gstr9Table7,
    next8: Gstr9Table8,
  ) => ({
    table6: {
      ...next6,
      totalItcAvailed:
        next6.importOfGoods +
        next6.importOfServices +
        next6.inwardSuppliesRcm +
        next6.inwardSuppliesIsd +
        next6.allOtherItc +
        next6.precedingFinancialYearItc,
    },
    table7: {
      ...next7,
      total:
        next7.rule38 +
        next7.rule39 +
        next7.rule42 +
        next7.rule43 +
        next7.section17_5 +
        next7.reversalUnderRule37 +
        next7.reversalUnderRule37A +
        next7.otherReversals,
    },
    table8: {
      ...next8,
      totalOtherItc:
        next8.itcAsPerGstr2bTable8A +
        next8.itcAsPerBooks +
        next8.creditAvailableButNotAvailed +
        next8.creditAvailableIneligible +
        next8.creditIneligibleUnderSection16_4,
    },
  });

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);

    try {
      const totals = calculateTotals(table6, table7, table8);
      const now = new Date().toISOString();

      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt: existingItc?.metadata.enteredAt ?? now,
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
        itcTables: {
          table6: totals.table6,
          table7: totals.table7,
          table8: totals.table8,
          metadata,
        },
      };

      await saveGstr9InputRecord(record);
      onSaved(record);

      setMessage(
        `${source === "IMPORT" ? "Imported" : "Manual entry"} saved successfully.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save ITC Tables 6-8 input.",
      );
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;

      const root = parsed.itcTables &&
        typeof parsed.itcTables === "object"
        ? parsed.itcTables as Record<string, unknown>
        : parsed;

      const imported6 =
        root.table6 && typeof root.table6 === "object"
          ? root.table6 as Partial<Gstr9Table6>
          : {};

      const imported7 =
        root.table7 && typeof root.table7 === "object"
          ? root.table7 as Partial<Gstr9Table7>
          : {};

      const imported8 =
        root.table8 && typeof root.table8 === "object"
          ? root.table8 as Partial<Gstr9Table8>
          : {};

      const n = (value: unknown) => {
        const parsedValue = Number(value ?? 0);
        return Number.isFinite(parsedValue) && parsedValue >= 0
          ? parsedValue
          : 0;
      };

      const next6: Gstr9Table6 = {
        importOfGoods: n(imported6.importOfGoods),
        importOfServices: n(imported6.importOfServices),
        inwardSuppliesRcm: n(imported6.inwardSuppliesRcm),
        inwardSuppliesIsd: n(imported6.inwardSuppliesIsd),
        allOtherItc: n(imported6.allOtherItc),
        totalItcAvailed: 0,
        precedingFinancialYearItc: n(imported6.precedingFinancialYearItc),
      };

      const next7: Gstr9Table7 = {
        rule38: n(imported7.rule38),
        rule39: n(imported7.rule39),
        rule42: n(imported7.rule42),
        rule43: n(imported7.rule43),
        section17_5: n(imported7.section17_5),
        reversalUnderRule37: n(imported7.reversalUnderRule37),
        reversalUnderRule37A: n(imported7.reversalUnderRule37A),
        otherReversals: n(imported7.otherReversals),
        total: 0,
      };

      const next8: Gstr9Table8 = {
        itcAsPerGstr2bTable8A: n(imported8.itcAsPerGstr2bTable8A),
        itcAsPerBooks: n(imported8.itcAsPerBooks),
        creditAvailableButNotAvailed: n(
          imported8.creditAvailableButNotAvailed,
        ),
        creditAvailableIneligible: n(
          imported8.creditAvailableIneligible,
        ),
        creditIneligibleUnderSection16_4: n(
          imported8.creditIneligibleUnderSection16_4,
        ),
        totalOtherItc: 0,
      };

      const totals = calculateTotals(next6, next7, next8);

      setTable6(totals.table6);
      setTable7(totals.table7);
      setTable8(totals.table8);

      const metadata =
        root.metadata && typeof root.metadata === "object"
          ? root.metadata as Record<string, unknown>
          : {};

      const importedSourceName = String(
        metadata.sourceName ?? root.sourceName ?? "",
      ).trim();

      const importedSourceReference = String(
        metadata.sourceReference ?? root.sourceReference ?? "",
      ).trim();

      const importedNotes = String(
        metadata.notes ?? root.notes ?? "",
      ).trim();

      if (importedSourceName) setSourceName(importedSourceName);
      if (importedSourceReference) {
        setSourceReference(importedSourceReference);
      }
      if (importedNotes) setNotes(importedNotes);

      setTab("IMPORT");
      setMessage(
        "JSON loaded. Review the values, then click Save imported ITC Tables.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to read the JSON file.",
      );
    }
  };

  const updateTable6 = (
    key: keyof Gstr9Table6,
    value: string,
  ) => {
    setTable6((current) => ({
      ...current,
      [key]: numberValue(value),
    }));
  };

  const updateTable7 = (
    key: keyof Gstr9Table7,
    value: string,
  ) => {
    setTable7((current) => ({
      ...current,
      [key]: numberValue(value),
    }));
  };

  const updateTable8 = (
    key: keyof Gstr9Table8,
    value: string,
  ) => {
    setTable8((current) => ({
      ...current,
      [key]: numberValue(value),
    }));
  };

  const field = (
    label: string,
    value: number,
    onChange: (value: string) => void,
  ) => (
    <div className="rounded-md border bg-background p-3">
      <label className="text-sm font-medium">{label}</label>
      <Input
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2"
      />
    </div>
  );

  return (
    <Card className="mt-4">
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 className="font-semibold">
              ITC Tables 6, 7 &amp; 8 — FY {financialYear}
            </h3>
            <p className="text-sm text-muted-foreground">
              Enter or import annual ITC figures separately from GSTR-2B
              and GSTR-3B.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          <div className="mb-4 flex gap-2">
            <Button
              variant={tab === "MANUAL" ? "default" : "outline"}
              onClick={() => setTab("MANUAL")}
            >
              Manual Entry
            </Button>

            <Button
              variant={tab === "IMPORT" ? "default" : "outline"}
              onClick={() => setTab("IMPORT")}
            >
              Import JSON
            </Button>
          </div>

          {tab === "IMPORT" && (
            <div className="mb-5 rounded-md border border-dashed p-4">
              <label className="text-sm font-medium">
                Select ITC JSON file
              </label>

              <Input
                type="file"
                accept=".json,application/json"
                className="mt-2"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importJson(file);
                }}
              />

              <p className="mt-2 text-xs text-muted-foreground">
                Expected sections: table6, table7 and table8.
                Review imported values before saving.
              </p>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <Input
              placeholder="Source name"
              value={sourceName}
              onChange={(event) => setSourceName(event.target.value)}
            />

            <Input
              placeholder="Source reference"
              value={sourceReference}
              onChange={(event) => setSourceReference(event.target.value)}
            />

            <Input
              placeholder="Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <section className="mt-5 rounded-md border p-4">
            <h4 className="font-semibold">
              Table 6 — ITC Availed
            </h4>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {field(
                "Import of goods",
                table6.importOfGoods,
                (value) => updateTable6("importOfGoods", value),
              )}

              {field(
                "Import of services",
                table6.importOfServices,
                (value) => updateTable6("importOfServices", value),
              )}

              {field(
                "Inward supplies liable to RCM",
                table6.inwardSuppliesRcm,
                (value) => updateTable6("inwardSuppliesRcm", value),
              )}

              {field(
                "Inward supplies from ISD",
                table6.inwardSuppliesIsd,
                (value) => updateTable6("inwardSuppliesIsd", value),
              )}

              {field(
                "All other ITC",
                table6.allOtherItc,
                (value) => updateTable6("allOtherItc", value),
              )}

              {field(
                "Preceding FY ITC",
                table6.precedingFinancialYearItc,
                (value) =>
                  updateTable6("precedingFinancialYearItc", value),
              )}
            </div>

            <div className="mt-3 rounded-md bg-muted p-3">
              <div className="text-sm text-muted-foreground">
                Total ITC availed
              </div>
              <div className="text-lg font-semibold">
                {money(
                  table6.importOfGoods +
                  table6.importOfServices +
                  table6.inwardSuppliesRcm +
                  table6.inwardSuppliesIsd +
                  table6.allOtherItc +
                  table6.precedingFinancialYearItc,
                )}
              </div>
            </div>
          </section>

          <section className="mt-5 rounded-md border p-4">
            <h4 className="font-semibold">
              Table 7 — ITC Reversed / Ineligible
            </h4>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {field(
                "Rule 38",
                table7.rule38,
                (value) => updateTable7("rule38", value),
              )}

              {field(
                "Rule 39",
                table7.rule39,
                (value) => updateTable7("rule39", value),
              )}

              {field(
                "Rule 42",
                table7.rule42,
                (value) => updateTable7("rule42", value),
              )}

              {field(
                "Rule 43",
                table7.rule43,
                (value) => updateTable7("rule43", value),
              )}

              {field(
                "Section 17(5)",
                table7.section17_5,
                (value) => updateTable7("section17_5", value),
              )}

              {field(
                "Reversal under Rule 37",
                table7.reversalUnderRule37,
                (value) =>
                  updateTable7("reversalUnderRule37", value),
              )}

              {field(
                "Reversal under Rule 37A",
                table7.reversalUnderRule37A,
                (value) =>
                  updateTable7("reversalUnderRule37A", value),
              )}

              {field(
                "Other reversals",
                table7.otherReversals,
                (value) => updateTable7("otherReversals", value),
              )}
            </div>

            <div className="mt-3 rounded-md bg-muted p-3">
              <div className="text-sm text-muted-foreground">
                Total ITC reversed / ineligible
              </div>
              <div className="text-lg font-semibold">
                {money(
                  table7.rule38 +
                  table7.rule39 +
                  table7.rule42 +
                  table7.rule43 +
                  table7.section17_5 +
                  table7.reversalUnderRule37 +
                  table7.reversalUnderRule37A +
                  table7.otherReversals,
                )}
              </div>
            </div>
          </section>

          <section className="mt-5 rounded-md border p-4">
            <h4 className="font-semibold">
              Table 8 — Other ITC Information
            </h4>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {field(
                "ITC as per GSTR-2B — Table 8A",
                table8.itcAsPerGstr2bTable8A,
                (value) =>
                  updateTable8("itcAsPerGstr2bTable8A", value),
              )}

              {field(
                "ITC as per books",
                table8.itcAsPerBooks,
                (value) => updateTable8("itcAsPerBooks", value),
              )}

              {field(
                "Credit available but not availed",
                table8.creditAvailableButNotAvailed,
                (value) =>
                  updateTable8(
                    "creditAvailableButNotAvailed",
                    value,
                  ),
              )}

              {field(
                "Credit available but ineligible",
                table8.creditAvailableIneligible,
                (value) =>
                  updateTable8(
                    "creditAvailableIneligible",
                    value,
                  ),
              )}

              {field(
                "Credit ineligible under Section 16(4)",
                table8.creditIneligibleUnderSection16_4,
                (value) =>
                  updateTable8(
                    "creditIneligibleUnderSection16_4",
                    value,
                  ),
              )}
            </div>

            <div className="mt-3 rounded-md bg-muted p-3">
              <div className="text-sm text-muted-foreground">
                Total Table 8 input
              </div>
              <div className="text-lg font-semibold">
                {money(
                  table8.itcAsPerGstr2bTable8A +
                  table8.itcAsPerBooks +
                  table8.creditAvailableButNotAvailed +
                  table8.creditAvailableIneligible +
                  table8.creditIneligibleUnderSection16_4,
                )}
              </div>
            </div>
          </section>

          {message && (
            <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {message}
            </div>
          )}

          <div className="mt-5 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            GSTR-2B and GSTR-3B inputs remain separate. These Tables 6-8
            figures are stored as their own input and can be reconciled
            later.
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t bg-background px-4 pb-3 pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>

          <Button
            onClick={() =>
              void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")
            }
            disabled={saving}
          >
            <Save className="mr-1 h-4 w-4" />
            {saving
              ? "Saving…"
              : tab === "IMPORT"
                ? "Save imported ITC Tables"
                : "Save manual ITC Tables"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}



function Gstr3bInputPanel({
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
  const existingGstr3b = existing?.gstr3b;
  const [tab, setTab] = useState<"MANUAL" | "EXCEL" | "JSON">("MANUAL");

  const [periods, setPeriods] = useState<Gstr9Gstr3bPeriod[]>(() => {
    const defaults = gstr3bPeriodsForFinancialYear(financialYear);

    if (existingGstr3b?.periods?.length) {
      return defaults.map((period, index) =>
        existingGstr3b.periods[index]
          ? cloneGstr3bPeriod(existingGstr3b.periods[index])
          : emptyGstr3bPeriod(period),
      );
    }

    return defaults.map(emptyGstr3bPeriod);
  });

  const [sourceName, setSourceName] = useState(
    existingGstr3b?.metadata.sourceName ?? "Filed GSTR-3B",
  );

  const [sourceReference, setSourceReference] = useState(
    existingGstr3b?.metadata.sourceReference ?? "",
  );

  const [notes, setNotes] = useState(
    existingGstr3b?.metadata.notes ?? "",
  );

  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [excelWarnings, setExcelWarnings] = useState<string[]>([]);

  const [excelSummary, setExcelSummary] = useState<{
    fileCount: number;
    importedPeriods: string[];
  } | null>(null);

  const updatePeriod = (
    index: number,
    updater: (
      current: Gstr9Gstr3bPeriod,
    ) => Gstr9Gstr3bPeriod,
  ) => {
    setPeriods((current) =>
      current.map((period, periodIndex) =>
        periodIndex === index
          ? updater(period)
          : period,
      ),
    );
  };

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);

    try {
      const now = new Date().toISOString();

      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt:
          existingGstr3b?.metadata.enteredAt ?? now,
        updatedAt: now,
        sourceName:
          sourceName.trim() || undefined,
        sourceReference:
          sourceReference.trim() || undefined,
        notes:
          notes.trim() || undefined,
      };

      const record: Gstr9InputRecord = {
        ...(existing ?? {
          id: `${companyId}:${financialYear}`,
          companyId,
          financialYear,
        }),
        gstr3b: {
          periods,
          metadata,
        },
      };

      await saveGstr9InputRecord(record);

      onSaved(record);

      setMessage(
        `${
          source === "IMPORT"
            ? "Imported"
            : "Manual entry"
        } saved successfully.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save GSTR-3B input.",
      );
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;

      const imported = normaliseGstr3bImport(
        parsed,
        financialYear,
      );

      setPeriods(imported.periods);

      if (imported.sourceName) {
        setSourceName(imported.sourceName);
      }

      if (imported.sourceReference) {
        setSourceReference(
          imported.sourceReference,
        );
      }

      if (imported.notes) {
        setNotes(imported.notes);
      }

      setExcelWarnings([]);
      setExcelSummary(null);

      setTab("JSON");

      setMessage(
        "JSON loaded. Review the values, then click Save imported GSTR-3B.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to read the JSON file.",
      );
    }
  };

  const importExcelFiles = async (
    files: FileList | File[],
  ) => {
    setMessage(null);
    setExcelWarnings([]);
    setExcelSummary(null);

    const fileArray = Array.from(files);

    if (fileArray.length === 0) {
      return;
    }

    const warnings: string[] = [];
    const importedPeriods: string[] = [];
    const analyses: Array<{
      file: File;
      period: Gstr9Gstr3bPeriod;
      companyName: string | null;
      warnings: string[];
    }> = [];

    for (const file of fileArray) {
      try {
        const analysis =
          analyseGstr3bExcelBuffer(
            await file.arrayBuffer(),
            {
              fileName: file.name,
              expectedFinancialYear:
                financialYear,
            },
          );

        const fyMismatch =
          analysis.warnings.some(
            (warning) =>
              warning.includes(
                "does not match selected FY",
              ) &&
              warning.includes(
                "Nothing should be saved",
              ),
          );

        if (fyMismatch) {
          warnings.push(
            `${file.name}: ${analysis.warnings.join(
              " ",
            )}`,
          );
          continue;
        }

        analyses.push({
          file,
          period: analysis.period,
          companyName:
            analysis.metadata.companyName,
          warnings: analysis.warnings,
        });

        importedPeriods.push(
          analysis.period.period,
        );

        for (const warning of analysis.warnings) {
          warnings.push(
            `${file.name}: ${warning}`,
          );
        }
      } catch (error) {
        warnings.push(
          `${file.name}: ${
            error instanceof Error
              ? error.message
              : "Unable to read this GSTR-3B Excel file."
          }`,
        );
      }
    }

    if (analyses.length === 0) {
      setExcelWarnings(warnings);
      setTab("EXCEL");

      setMessage(
        "No valid GSTR-3B Excel file was imported. Nothing was changed.",
      );

      return;
    }

    setPeriods((current) => {
      const next = current.map(
        cloneGstr3bPeriod,
      );

      for (const analysis of analyses) {
        const index = next.findIndex(
          (period) =>
            period.period ===
            analysis.period.period,
        );

        if (index < 0) {
          warnings.push(
            `${analysis.file.name}: period ${analysis.period.period} is outside the selected FY and was not imported.`,
          );
          continue;
        }

        const alreadyImported =
          importedPeriods.filter(
            (period) =>
              period ===
              analysis.period.period,
          ).length > 1;

        if (alreadyImported) {
          const duplicateMessage =
            `${analysis.file.name}: ${analysis.period.period} was imported more than once. The later file replaces the earlier file for that month.`;

          if (
            !warnings.includes(
              duplicateMessage,
            )
          ) {
            warnings.push(
              duplicateMessage,
            );
          }
        }

        next[index] = cloneGstr3bPeriod(
          analysis.period,
        );
      }

      return next;
    });

    const companyNames = analyses
      .map((item) =>
        item.companyName?.trim(),
      )
      .filter(
        (value): value is string =>
          Boolean(value),
      );

    const uniqueCompanyNames =
      Array.from(
        new Set(companyNames),
      );

    setSourceName(
      uniqueCompanyNames.length === 1
        ? `Filed GSTR-3B Excel — ${uniqueCompanyNames[0]}`
        : "Filed GSTR-3B Excel",
    );

    setSourceReference(
      analyses
        .map(
          (analysis) =>
            analysis.file.name,
        )
        .join(", "),
    );

    setNotes(
      warnings.length > 0
        ? `Imported from GSTN GSTR-3B Excel. Warnings: ${warnings.join(
            " | ",
          )}`
        : "Imported from GSTN GSTR-3B Excel.",
    );

    setExcelWarnings(warnings);

    setExcelSummary({
      fileCount: analyses.length,
      importedPeriods: Array.from(
        new Set(importedPeriods),
      ),
    });

    setTab("EXCEL");

    setMessage(
      `${analyses.length} GSTR-3B Excel file${
        analyses.length === 1
          ? ""
          : "s"
      } loaded. Review the monthly figures and warnings, then click Save imported GSTR-3B.`,
    );
  };

  const isImportedTab =
    tab === "EXCEL" ||
    tab === "JSON";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-7xl flex-col overflow-hidden shadow-xl">

        <CardHeader className="flex flex-none flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">
              Filed GSTR-3B Input — FY {financialYear}
            </CardTitle>

            <p className="mt-1 text-xs text-muted-foreground">
              Enter or import monthly GSTR-3B figures.
              Manual entry and imports use the same
              local GSTR-9 input store.
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">

          <div className="mb-4 flex flex-wrap gap-2 border-b pb-3">

            <Button
              size="sm"
              variant={
                tab === "MANUAL"
                  ? "default"
                  : "outline"
              }
              onClick={() =>
                setTab("MANUAL")
              }
            >
              Manual Entry
            </Button>

            <Button
              size="sm"
              variant={
                tab === "EXCEL"
                  ? "default"
                  : "outline"
              }
              onClick={() =>
                setTab("EXCEL")
              }
            >
              <Upload className="mr-1 h-4 w-4" />
              Import Excel
            </Button>

            <Button
              size="sm"
              variant={
                tab === "JSON"
                  ? "default"
                  : "outline"
              }
              onClick={() =>
                setTab("JSON")
              }
            >
              <Upload className="mr-1 h-4 w-4" />
              Import JSON
            </Button>

          </div>

          {tab === "EXCEL" && (
            <div className="mb-4 rounded-md border border-dashed p-4">

              <div className="text-sm font-medium">
                Import GSTN GSTR-3B Excel
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Select one or more monthly GSTN GSTR-3B
                Offline Utility workbooks. Supported
                formats are XLS, XLSX and XLSM.
                The Year and Month in each workbook are
                used to place the figures into the correct
                April-to-March period.
              </p>

              <input
                type="file"
                multiple
                accept=".xls,.xlsx,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
                className="mt-3 block text-sm"
                onChange={(event) => {
                  const files =
                    event.target.files;

                  if (files?.length) {
                    void importExcelFiles(files);
                  }

                  event.currentTarget.value =
                    "";
                }}
              />

              {excelSummary && (
                <div className="mt-4 rounded-md border bg-muted/20 p-3">

                  <div className="text-xs font-semibold">
                    Excel import review
                  </div>

                  <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">

                    <div>
                      <span className="text-muted-foreground">
                        Files loaded:
                      </span>{" "}
                      <strong>
                        {excelSummary.fileCount}
                      </strong>
                    </div>

                    <div>
                      <span className="text-muted-foreground">
                        Months loaded:
                      </span>{" "}
                      <strong>
                        {excelSummary.importedPeriods.length}
                      </strong>
                    </div>

                  </div>

                  <div className="mt-2 text-xs">
                    <span className="text-muted-foreground">
                      Periods:
                    </span>{" "}
                    {excelSummary.importedPeriods.join(
                      ", ",
                    )}
                  </div>

                </div>
              )}

              {excelWarnings.length > 0 && (
                <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">

                  <div className="font-semibold">
                    Review warnings before saving
                  </div>

                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {excelWarnings.map(
                      (warning, index) => (
                        <li key={`${warning}-${index}`}>
                          {warning}
                        </li>
                      ),
                    )}
                  </ul>

                </div>
              )}

            </div>
          )}

          {tab === "JSON" && (
            <div className="mb-4 rounded-md border border-dashed p-4">

              <div className="text-sm font-medium">
                Import GSTR-3B structured JSON
              </div>

              <p className="mt-1 text-xs text-muted-foreground">
                Import a JSON containing a{" "}
                <code>periods</code> array, or a
                wrapper containing{" "}
                <code>gstr3b.periods</code>.
                Periods are matched April-to-March.
              </p>

              <input
                type="file"
                accept=".json,application/json"
                className="mt-3 block text-sm"
                onChange={(event) => {
                  const file =
                    event.target.files?.[0];

                  if (file) {
                    void importJson(file);
                  }

                  event.currentTarget.value =
                    "";
                }}
              />

            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">

            <label className="space-y-1">
              <span className="text-xs font-medium">
                Source name
              </span>

              <input
                value={sourceName}
                onChange={(event) =>
                  setSourceName(
                    event.target.value,
                  )
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium">
                Source reference
              </span>

              <input
                value={sourceReference}
                onChange={(event) =>
                  setSourceReference(
                    event.target.value,
                  )
                }
                placeholder="e.g. ARN / file name"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium">
                Notes
              </span>

              <input
                value={notes}
                onChange={(event) =>
                  setNotes(
                    event.target.value,
                  )
                }
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              />
            </label>

          </div>

          <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <strong>Tax payment:</strong>{" "}
            IGST, CGST, SGST and Cess are stored as GST
            tax paid. Interest, late fee, penalty and
            other payments are captured separately and
            are not included in GST tax-paid totals.
          </div>

          <div className="mt-5 space-y-3">

            {periods.map((period, index) => (
              <details
                key={`${period.period}-${index}`}
                open={index === 0}
                className="rounded-md border"
              >

                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">
                  {period.period}
                </summary>

                <div className="space-y-5 border-t p-4">

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Outward supplies / tax liability
                    </h3>

                    <TaxAmountFields
                      value={period.outwardTax}
                      onChange={(value) =>
                        updatePeriod(
                          index,
                          (current) => ({
                            ...current,
                            outwardTax: value,
                          }),
                        )
                      }
                    />
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      ITC availed — Table 4(A)
                    </h3>

                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">

                      {GSTR3B_ITC_FIELDS.map(
                        ([field, label]) => (
                          <label
                            key={field}
                            className="space-y-1"
                          >

                            <span className="text-[11px] text-muted-foreground">
                              {label}
                            </span>

                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                period.itc[field]
                              }
                              onChange={(event) =>
                                updatePeriod(
                                  index,
                                  (current) => {
                                    const itc = {
                                      ...current.itc,
                                      [field]:
                                        numberValue(
                                          event.target
                                            .value,
                                        ),
                                    };

                                    itc.totalItcAvailed =
                                      itc.table4A1ImportOfGoods +
                                      itc.table4A2ImportOfServices +
                                      itc.table4A3Rcm +
                                      itc.table4A4Isd +
                                      itc.table4A5Other;

                                    return {
                                      ...current,
                                      itc,
                                    };
                                  },
                                )
                              }
                              className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                            />

                          </label>
                        ),
                      )}

                    </div>

                    <div className="mt-2 text-right text-xs font-semibold">
                      Total ITC availed:{" "}
                      {money(
                        period.itc
                          .totalItcAvailed,
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      ITC reversals
                    </h3>

                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">

                      {GSTR3B_REVERSAL_FIELDS.map(
                        ([field, label]) => (
                          <label
                            key={field}
                            className="space-y-1"
                          >

                            <span className="text-[11px] text-muted-foreground">
                              {label}
                            </span>

                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={
                                period.itcReversal[
                                  field
                                ]
                              }
                              onChange={(event) =>
                                updatePeriod(
                                  index,
                                  (current) => {
                                    const itcReversal =
                                      {
                                        ...current.itcReversal,
                                        [field]:
                                          numberValue(
                                            event
                                              .target
                                              .value,
                                          ),
                                      };

                                    itcReversal.total =
                                      itcReversal.rule38 +
                                      itcReversal.rule42 +
                                      itcReversal.rule43 +
                                      itcReversal.section17_5 +
                                      itcReversal.other;

                                    return {
                                      ...current,
                                      itcReversal,
                                    };
                                  },
                                )
                              }
                              className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                            />

                          </label>
                        ),
                      )}

                    </div>

                    <div className="mt-2 text-right text-xs font-semibold">
                      Total ITC reversal:{" "}
                      {money(
                        period.itcReversal
                          .total,
                      )}
                    </div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tax paid
                    </h3>

                    <div className="space-y-3">

                      {GSTR3B_TAX_PAID_TAX_FIELDS.map(
                        ([field, label]) => (
                          <div
                            key={field}
                            className="rounded-md border p-3"
                          >

                            <div className="mb-2 text-xs font-semibold">
                              {label}
                            </div>

                            <div className="grid gap-2 md:grid-cols-3">

                              {(
                                [
                                  [
                                    "taxPayable",
                                    "Tax payable",
                                  ],
                                  [
                                    "paidThroughCash",
                                    "Paid through cash",
                                  ],
                                  [
                                    "paidThroughItc",
                                    "Paid through ITC",
                                  ],
                                ] as Array<
                                  [
                                    Gstr9TaxPaidRowField,
                                    string,
                                  ]
                                >
                              ).map(
                                ([
                                  rowField,
                                  rowLabel,
                                ]) => (
                                  <label
                                    key={rowField}
                                    className="space-y-1"
                                  >

                                    <span className="text-[11px] text-muted-foreground">
                                      {rowLabel}
                                    </span>

                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={
                                        period.taxPaid[
                                          field
                                        ][rowField]
                                      }
                                      onChange={(
                                        event,
                                      ) =>
                                        updatePeriod(
                                          index,
                                          (
                                            current,
                                          ) => ({
                                            ...current,
                                            taxPaid:
                                              {
                                                ...current.taxPaid,
                                                [field]:
                                                  {
                                                    ...current
                                                      .taxPaid[
                                                      field
                                                    ],
                                                    [rowField]:
                                                      numberValue(
                                                        event
                                                          .target
                                                          .value,
                                                      ),
                                                  },
                                              },
                                          }),
                                        )
                                      }
                                      className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                                    />

                                  </label>
                                ),
                              )}

                            </div>
                          </div>
                        ),
                      )}

                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">

                        {GSTR3B_TAX_PAID_OTHER_FIELDS.map(
                          ([field, label]) => (
                            <label
                              key={field}
                              className="space-y-1"
                            >

                              <span className="text-[11px] text-muted-foreground">
                                {label}
                              </span>

                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={
                                  period.taxPaid[
                                    field
                                  ]
                                }
                                onChange={(event) =>
                                  updatePeriod(
                                    index,
                                    (current) => ({
                                      ...current,
                                      taxPaid: {
                                        ...current.taxPaid,
                                        [field]:
                                          numberValue(
                                            event.target
                                              .value,
                                          ),
                                      },
                                    }),
                                  )
                                }
                                className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                              />

                            </label>
                          ),
                        )}

                      </div>

                    </div>
                  </section>

                </div>
              </details>
            ))}

          </div>

          <Gstr3bReviewSummary
            periods={periods}
          />

        </CardContent>

        <div className="flex-none border-t bg-background px-4 py-3">

          {message && (
            <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {message}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">

            <div className="text-xs text-muted-foreground">
              Review the totals above, then save.
              The saved record can be reopened from
              the GSTR-3B card.
            </div>

            <div className="flex shrink-0 gap-2">

              <Button
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>

              <Button
                onClick={() =>
                  void save(
                    isImportedTab
                      ? "IMPORT"
                      : "MANUAL",
                  )
                }
                disabled={saving}
              >

                <Save className="mr-1 h-4 w-4" />

                {saving
                  ? "Saving…"
                  : isImportedTab
                    ? "Save imported GSTR-3B"
                    : "Save manual GSTR-3B"}

              </Button>

            </div>
          </div>
        </div>

      </Card>
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
  const [tab, setTab] = useState<"MANUAL" | "JSON" | "EXCEL">("MANUAL");
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
  const [excelWarnings, setExcelWarnings] = useState<string[]>([]);
  const [excelSummary, setExcelSummary] = useState<{
    companyName?: string;
    gstin?: string;
    financialYear?: string;
    sheetCount: number;
    adjustmentCount: number;
    hsnRowCount: number;
  } | null>(null);

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
      setExcelWarnings([]);
      setExcelSummary(null);
      setTab("JSON");
      setMessage("JSON loaded. Review the values, then click Save imported GSTR-1.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the JSON file.");
    }
  };

  const importExcel = async (file: File) => {
    try {
      setMessage(null);
      setExcelWarnings([]);
      setExcelSummary(null);

      const analysis = analyseGstr1ExcelBuffer(await file.arrayBuffer(), {
        fileName: file.name,
        expectedFinancialYear: financialYear,
      });

      const financialYearMismatch = analysis.warnings.find((warning) =>
        warning.includes("does not match selected FY") && warning.includes("Nothing was saved"),
      );

      if (financialYearMismatch) {
        setExcelWarnings(analysis.warnings);
        setMessage(financialYearMismatch);
        setTab("EXCEL");
        return;
      }

      setTable4(analysis.table4);
      setTable5(analysis.table5);
      setSourceName(
        analysis.companyName?.trim()
          ? `Filed GSTR-1 Excel — ${analysis.companyName.trim()}`
          : "Filed GSTR-1 Excel",
      );
      setSourceReference(file.name);
      setNotes(
        analysis.warnings.length > 0
          ? `Imported from GSTR-1 Excel. Warnings: ${analysis.warnings.join(" | ")}`
          : "Imported from GSTR-1 Excel.",
      );
      setExcelWarnings(analysis.warnings);
      setExcelSummary({
        companyName: analysis.companyName,
        gstin: analysis.gstin,
        financialYear: analysis.financialYear,
        sheetCount: analysis.sheetSummary.length,
        adjustmentCount: analysis.adjustments.length,
        hsnRowCount: analysis.hsn.rowCount,
      });
      setTab("EXCEL");
      setMessage("Excel loaded. Review the values and warnings, then click Save imported GSTR-1.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the GSTR-1 Excel file.");
      setTab("EXCEL");
    }
  };

  const isImportedTab = tab === "JSON" || tab === "EXCEL";
  const canSaveExcel = tab !== "EXCEL" || !excelWarnings.some((warning) =>
    warning.includes("does not match selected FY") && warning.includes("Nothing was saved"),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-6xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-none flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">Filed GSTR-1 Input — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Manual entry, JSON import and Excel import use the same local GSTR-9 input store.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex flex-wrap gap-2 border-b pb-3">
            <Button size="sm" variant={tab === "MANUAL" ? "default" : "outline"} onClick={() => setTab("MANUAL")}>
              Manual Entry
            </Button>
            <Button size="sm" variant={tab === "JSON" ? "default" : "outline"} onClick={() => setTab("JSON")}>
              <Upload className="mr-1 h-4 w-4" /> Import JSON
            </Button>
            <Button size="sm" variant={tab === "EXCEL" ? "default" : "outline"} onClick={() => setTab("EXCEL")}>
              <Upload className="mr-1 h-4 w-4" /> Import Excel
            </Button>
          </div>

          {tab === "JSON" && (
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

          {tab === "EXCEL" && (
            <div className="mb-4 rounded-md border border-dashed p-4">
              <div className="text-sm font-medium">Import GSTR-1 Excel workbook</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Select the GSTR-1 Excel workbook. The analyser reads the supported GSTR-1 sheets and loads Table 4 and Table 5 for review. Nothing is saved until you click Save imported GSTR-1.
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                className="mt-3 block text-sm"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importExcel(file);
                  event.currentTarget.value = "";
                }}
              />

              {excelSummary && (
                <div className="mt-4 grid gap-2 rounded-md border bg-muted/30 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <div className="text-muted-foreground">Workbook company</div>
                    <div className="font-medium">{excelSummary.companyName || "Not detected"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Workbook GSTIN</div>
                    <div className="font-medium">{excelSummary.gstin || "Not detected"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Workbook FY</div>
                    <div className="font-medium">{excelSummary.financialYear || "Not detected"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sheets analysed</div>
                    <div className="font-medium">{excelSummary.sheetCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Adjustment sheets with data</div>
                    <div className="font-medium">{excelSummary.adjustmentCount}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">HSN rows detected</div>
                    <div className="font-medium">{excelSummary.hsnRowCount}</div>
                  </div>
                </div>
              )}

              {excelWarnings.length > 0 && (
                <div className="mt-3 space-y-2">
                  {excelWarnings.map((warning) => (
                    <div key={warning} className="flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{warning}</span>
                    </div>
                  ))}
                </div>
              )}
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
        </CardContent>

        <div className="flex flex-none items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save(isImportedTab ? "IMPORT" : "MANUAL")} disabled={saving || !canSaveExcel}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? "Saving…" : isImportedTab ? "Save imported GSTR-1" : "Save manual GSTR-1"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

const GSTR9_TAX_PAID_TAX_ROWS: Array<[keyof Pick<Gstr9TaxPaid, "igst" | "cgst" | "sgst" | "cess">, string]> = [
  ["igst", "Integrated Tax (IGST)"],
  ["cgst", "Central Tax (CGST)"],
  ["sgst", "State / UT Tax (SGST/UTGST)"],
  ["cess", "Cess"],
];

const GSTR9_TAX_PAID_OTHER_ROWS: Array<[keyof Pick<Gstr9TaxPaid, "interest" | "lateFee" | "penalty" | "others">, string]> = [
  ["interest", "Interest"],
  ["lateFee", "Late Fee"],
  ["penalty", "Penalty"],
  ["others", "Others"],
];

function normaliseGstr9TaxPaid(value: unknown): Gstr9TaxPaid {
  const root = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = emptyGstr9TaxPaid();

  for (const [field] of GSTR9_TAX_PAID_TAX_ROWS) {
    result[field] = normaliseGstr9TaxPaidRow(root[field]);
  }

  for (const [field] of GSTR9_TAX_PAID_OTHER_ROWS) {
    result[field] = numberValue(String(root[field] ?? 0));
  }

  return result;
}

function Gstr9TaxPaymentInputPanel({
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
  const existingTaxPayment = existing?.taxPayment;
  const [tab, setTab] = useState<"MANUAL" | "IMPORT">("MANUAL");
  const [sourceMode, setSourceMode] = useState<"GSTN" | "BOOKS">(
    existingTaxPayment?.basedOnBooks ? "BOOKS" : "GSTN",
  );
  const [taxPaid, setTaxPaid] = useState<Gstr9TaxPaid>(
    existingTaxPayment?.table9.taxPaid ?? emptyGstr9TaxPaid(),
  );
  const [sourceName, setSourceName] = useState(existingTaxPayment?.metadata.sourceName ?? "");
  const [sourceReference, setSourceReference] = useState(existingTaxPayment?.metadata.sourceReference ?? "");
  const [notes, setNotes] = useState(existingTaxPayment?.metadata.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updateTaxRow = (
    field: "igst" | "cgst" | "sgst" | "cess",
    key: keyof Gstr9TaxPaidRow,
    value: string,
  ) => {
    setTaxPaid((current) => ({
      ...current,
      [field]: {
        ...current[field],
        [key]: numberValue(value),
      },
    }));
  };

  const updateOther = (
    field: "interest" | "lateFee" | "penalty" | "others",
    value: string,
  ) => {
    setTaxPaid((current) => ({
      ...current,
      [field]: numberValue(value),
    }));
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      const taxPaymentRoot = root.taxPayment && typeof root.taxPayment === "object"
        ? root.taxPayment as Record<string, unknown>
        : {};
      const table9Root = root.table9 && typeof root.table9 === "object"
        ? root.table9 as Record<string, unknown>
        : taxPaymentRoot.table9 && typeof taxPaymentRoot.table9 === "object"
          ? taxPaymentRoot.table9 as Record<string, unknown>
          : {};
      const rawTaxPaid = table9Root.taxPaid ?? taxPaymentRoot.taxPaid ?? root.taxPaid ?? parsed;
      setTaxPaid(normaliseGstr9TaxPaid(rawTaxPaid));

      const basedOnBooks = Boolean(
        table9Root.basedOnBooks ?? taxPaymentRoot.basedOnBooks ?? root.basedOnBooks ?? false,
      );
      setSourceMode(basedOnBooks ? "BOOKS" : "GSTN");

      const metadata = [table9Root.metadata, taxPaymentRoot.metadata, root.metadata].find(
        (item) => item && typeof item === "object",
      ) as Record<string, unknown> | undefined;
      const importedSourceName = String(metadata?.sourceName ?? root.sourceName ?? "").trim();
      const importedSourceReference = String(metadata?.sourceReference ?? root.sourceReference ?? "").trim();
      const importedNotes = String(metadata?.notes ?? root.notes ?? "").trim();

      if (importedSourceName) setSourceName(importedSourceName);
      if (importedSourceReference) setSourceReference(importedSourceReference);
      if (importedNotes) setNotes(importedNotes);

      setTab("IMPORT");
      setMessage("JSON loaded. Review the values, then click Save imported Table 9.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the JSON file.");
    }
  };

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt: existingTaxPayment?.metadata.enteredAt ?? now,
        updatedAt: now,
        sourceName: sourceName.trim() || undefined,
        sourceReference: sourceReference.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const record: Gstr9InputRecord = {
        ...(existing ?? { id: `${companyId}:${financialYear}`, companyId, financialYear }),
        taxPayment: {
          table9: { taxPaid },
          basedOnBooks: sourceMode === "BOOKS",
          metadata,
        },
      };
      await saveGstr9InputRecord(record);
      onSaved(record);
      setMessage(`${source === "IMPORT" ? "Imported" : "Manual entry"} Table 9 saved successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save Table 9 input.");
    } finally {
      setSaving(false);
    }
  };

  const taxTotal = GSTR9_TAX_PAID_TAX_ROWS.reduce(
    (sum, [field]) => sum + taxPaid[field].paidThroughCash + taxPaid[field].paidThroughItc,
    0,
  );
  const nonTaxTotal = GSTR9_TAX_PAID_OTHER_ROWS.reduce(
    (sum, [field]) => sum + taxPaid[field],
    0,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-6xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">GSTR-9 Table 9 — Tax Payment Data — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Details of tax paid as declared in returns filed during the financial year.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <div className="mb-4 flex shrink-0 gap-2 border-b pb-3">
            <Button size="sm" variant={tab === "MANUAL" ? "default" : "outline"} onClick={() => setTab("MANUAL")}>Manual Entry</Button>
            <Button size="sm" variant={tab === "IMPORT" ? "default" : "outline"} onClick={() => setTab("IMPORT")}>
              <Upload className="mr-1 h-4 w-4" /> Import JSON
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {tab === "IMPORT" && (
              <div className="mb-4 rounded-md border border-dashed p-4">
                <div className="text-sm font-medium">Import Table 9 structured JSON</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Accepted forms include <code>taxPayment.table9.taxPaid</code>, <code>table9.taxPaid</code>, or a top-level <code>taxPaid</code> object.
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

            <div className="rounded-md border p-4">
              <div className="text-sm font-semibold">Data source</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  className={`rounded-md border p-3 text-left ${sourceMode === "GSTN" ? "border-primary bg-primary/5" : "bg-background"}`}
                  onClick={() => setSourceMode("GSTN")}
                >
                  <div className="text-sm font-medium">GSTR-3B / GSTN reported values</div>
                  <div className="mt-1 text-xs text-muted-foreground">Enter or import values reported in filed returns. This app does not claim live GSTN reconciliation.</div>
                </button>
                <button
                  type="button"
                  className={`rounded-md border p-3 text-left ${sourceMode === "BOOKS" ? "border-primary bg-primary/5" : "bg-background"}`}
                  onClick={() => setSourceMode("BOOKS")}
                >
                  <div className="text-sm font-medium">Books Based</div>
                  <div className="mt-1 text-xs text-muted-foreground">Use payment/challan information from books when filed return or electronic cash-ledger data is unavailable.</div>
                </button>
              </div>
              <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${sourceMode === "BOOKS" ? "border-amber-300/50 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" : "bg-muted/30 text-muted-foreground"}`}>
                {sourceMode === "BOOKS"
                  ? "Books Based – Not GSTN Reconciled. Keep this separate from GSTN/system-populated figures."
                  : "GSTR-3B / GSTN reported values – user-entered or imported; verify against filed returns before filing."}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="space-y-1"><span className="text-xs font-medium">Source name</span><input value={sourceName} onChange={(event) => setSourceName(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" placeholder={sourceMode === "BOOKS" ? "e.g. GST payment challans" : "e.g. GSTR-3B FY 2025-26"} /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Source reference</span><input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" placeholder="e.g. ARN / file name / challan reference" /></label>
              <label className="space-y-1"><span className="text-xs font-medium">Notes</span><input value={notes} onChange={(event) => setNotes(event.target.value)} className="h-9 w-full rounded-md border bg-background px-3 text-sm" /></label>
            </div>

            <div className="mt-5 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Particulars</TableHead>
                    <TableHead className="text-right">Tax Payable</TableHead>
                    <TableHead className="text-right">Paid through Cash</TableHead>
                    <TableHead className="text-right">Paid through ITC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {GSTR9_TAX_PAID_TAX_ROWS.map(([field, label]) => (
                    <TableRow key={field}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="p-2"><Input type="number" min="0" step="0.01" value={taxPaid[field].taxPayable} onChange={(event) => updateTaxRow(field, "taxPayable", event.target.value)} className="h-8 text-right" /></TableCell>
                      <TableCell className="p-2"><Input type="number" min="0" step="0.01" value={taxPaid[field].paidThroughCash} onChange={(event) => updateTaxRow(field, "paidThroughCash", event.target.value)} className="h-8 text-right" /></TableCell>
                      <TableCell className="p-2"><Input type="number" min="0" step="0.01" value={taxPaid[field].paidThroughItc} onChange={(event) => updateTaxRow(field, "paidThroughItc", event.target.value)} className="h-8 text-right" /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Tax payment total</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{money(GSTR9_TAX_PAID_TAX_ROWS.reduce((sum, [field]) => sum + taxPaid[field].paidThroughCash, 0))}</TableCell>
                    <TableCell className="text-right">{money(GSTR9_TAX_PAID_TAX_ROWS.reduce((sum, [field]) => sum + taxPaid[field].paidThroughItc, 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="mt-5 overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Other payment particulars</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {GSTR9_TAX_PAID_OTHER_ROWS.map(([field, label]) => (
                    <TableRow key={field}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="p-2"><Input type="number" min="0" step="0.01" value={taxPaid[field]} onChange={(event) => updateOther(field, event.target.value)} className="h-8 text-right" /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Other payment total</TableCell>
                    <TableCell className="text-right">{money(nonTaxTotal)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              GST tax paid through Cash + ITC currently totals <strong>{money(taxTotal)}</strong>. Interest, Late Fee, Penalty and Others are intentionally kept separate from GST tax.
            </div>

            {message && <div className="mt-4 rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t bg-background pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")} disabled={saving}>
              <Save className="mr-1 h-4 w-4" />
              {saving ? "Saving…" : tab === "IMPORT" ? "Save imported Table 9" : "Save manual Table 9"}
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

function Gstr9ItcReconciliationPanel({
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
  const [sourceLines, setSourceLines] = useState<Gstr2bExcelLine[]>([]);
  const [purchases, setPurchases] = useState<{
    id: string;
    supplier_gstin: string | null;
    invoice_no: string | null;
    invoice_date: string | null;
    total_paise: number;
  }[]>([]);
  const [inclusionByKey, setInclusionByKey] = useState<Record<string, boolean>>(
    () => ({ ...(existing?.gstr9ItcInclusionByKey ?? {}) }),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reconciliation = useMemo(
    () => buildGstr9ItcReconciliation(
      sourceLines,
      purchases,
      { inclusionByKey },
    ),
    [sourceLines, purchases, inclusionByKey],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const latest = await latestGstr2bImport(companyId);
      if (!latest) {
        setSourceLines([]);
        setPurchases([]);
        throw new Error(`No GSTR-2B import is available for ${financialYear}. Import GSTR-2B first.`);
      }

      const rows = await loadGstr2bImportLines(latest.id);
      const regularSourceRows = rows.map((row) => ({
        section: row.section ?? "B2B",
        supplier_gstin: row.supplier_gstin,
        supplier_name: row.supplier_name ?? "",
        invoice_no: row.invoice_no,
        invoice_date: row.invoice_date,
        invoice_value_paise: row.invoice_value_paise,
        taxable_paise: row.taxable_paise,
        igst_paise: row.igst_paise,
        cgst_paise: row.cgst_paise,
        sgst_paise: row.sgst_paise,
        cess_paise: row.cess_paise,
        rev_charge: row.section === "RCM",
        gstr2b_period: row.gstr2b_period ?? null,
        gstr1_period: row.gstr1_period ?? null,
        gstr1_filing_date: row.gstr1_filing_date ?? null,
        source_type: "Stored GSTR-2B",
        is_einvoice_enabled: null,
        invoice_sub_type: row.document_type ?? "",
        is_ecom: null,
        itc_eligible: row.itc_eligible ?? null,
        itc_reason: row.itc_reason ?? null,
        cdnr_no: row.section === "CDNR" ? row.invoice_no : null,
        cdnr_date: row.section === "CDNR" ? row.invoice_date : null,
        cdnr_type: null,
      }));

      const localPurchases = await loadLocalPurchases(companyId);
      setSourceLines(regularSourceRows);
      setPurchases(localPurchases.map((purchase) => ({
        id: purchase.id,
        supplier_gstin: purchase.ledgers?.gstin ?? null,
        invoice_no: purchase.vendor_invoice_no ?? purchase.voucher_number ?? null,
        invoice_date: purchase.voucher_date ?? null,
        total_paise: purchase.total_paise,
      })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load GSTR-2B reconciliation.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [companyId, financialYear]);

  const updateLine = (line: Gstr9ItcReconciliationLine, include: boolean) => {
    setInclusionByKey((current) => ({
      ...current,
      [line.key]: include,
    }));
  };

  const setAll = (include: boolean) => {
    const nextLines = setAllEligibleGstr9ItcInclusion(reconciliation.regularB2b, include);
    setInclusionByKey((current) => {
      const next = { ...current };
      for (const line of nextLines) next[line.key] = line.includedInGstr9;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const nextTable8A = reconciliation.table8AWorkingPaise / 100;
      const existingItc = existing?.itcTables;
      const table6: Gstr9Table6 = existingItc?.table6 ?? {
        importOfGoods: 0,
        importOfServices: 0,
        inwardSuppliesRcm: 0,
        inwardSuppliesIsd: 0,
        allOtherItc: 0,
        totalItcAvailed: 0,
        precedingFinancialYearItc: 0,
      };
      const table7: Gstr9Table7 = existingItc?.table7 ?? {
        rule38: 0,
        rule39: 0,
        rule42: 0,
        rule43: 0,
        section17_5: 0,
        reversalUnderRule37: 0,
        reversalUnderRule37A: 0,
        otherReversals: 0,
        total: 0,
      };
      const oldTable8: Gstr9Table8 = existingItc?.table8 ?? {
        itcAsPerGstr2bTable8A: 0,
        itcAsPerBooks: 0,
        creditAvailableButNotAvailed: 0,
        creditAvailableIneligible: 0,
        creditIneligibleUnderSection16_4: 0,
        totalOtherItc: 0,
      };
      const table8: Gstr9Table8 = {
        ...oldTable8,
        itcAsPerGstr2bTable8A: nextTable8A,
        totalOtherItc:
          nextTable8A +
          oldTable8.itcAsPerBooks +
          oldTable8.creditAvailableButNotAvailed +
          oldTable8.creditAvailableIneligible +
          oldTable8.creditIneligibleUnderSection16_4,
      };

      const record: Gstr9InputRecord = {
        ...(existing ?? { id: `${companyId}:${financialYear}`, companyId, financialYear }),
        gstr9ItcInclusionByKey: { ...inclusionByKey },
        itcTables: {
          table6,
          table7,
          table8,
          metadata: {
            source: "IMPORT",
            enteredAt: existingItc?.metadata.enteredAt ?? now,
            updatedAt: now,
            sourceName: "GSTR-2B reconciliation for GSTR-9",
            sourceReference: "GSTR-2B local import",
            notes: `Table 8A working figure based on ${reconciliation.selectedRegularB2bTotals.count} selected eligible Regular B2B invoice(s). RCM and CDNR are kept separate.`,
          },
        },
      };

      await saveGstr9InputRecord(record);
      onSaved(record);
      setMessage(`Saved. GSTR-9 Table 8A working ITC: ${money(nextTable8A)}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to save GSTR-9 reconciliation.");
    } finally {
      setSaving(false);
    }
  };

  const selectedAll = reconciliation.regularB2b.length > 0 &&
    reconciliation.regularB2b.filter((line) => line.itc_eligible !== false).every((line) => line.includedInGstr9);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-7xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-none flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">GSTR-2B → GSTR-9 ITC Reconciliation — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Regular B2B invoices can be included in GSTR-9 independently of whether the purchase is already in Books. RCM and CDNR remain separate.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>

        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the latest saved GSTR-2B…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Regular B2B</div><div className="text-lg font-semibold">{reconciliation.regularB2bTotals.count}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Matched</div><div className="text-lg font-semibold">{reconciliation.matchedCount}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Not in Books</div><div className="text-lg font-semibold">{reconciliation.notInBooksCount}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Selected ITC</div><div className="text-lg font-semibold">{money(reconciliation.table8AWorkingPaise / 100)}</div></div>
                <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">RCM / CDNR</div><div className="text-lg font-semibold">{reconciliation.rcm.length} / {reconciliation.cdnr.length}</div></div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-3">
                <Button size="sm" onClick={() => setAll(true)} disabled={selectedAll || reconciliation.regularB2b.length === 0}>Select All Eligible</Button>
                <Button size="sm" variant="outline" onClick={() => setAll(false)} disabled={reconciliation.regularB2b.length === 0}>Unselect All</Button>
                <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>
                <div className="ml-auto text-xs text-muted-foreground">Ineligible ITC is never selected by Select All.</div>
              </div>

              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Include</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Eligibility</TableHead>
                      <TableHead className="text-right">ITC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliation.regularB2b.map((line) => {
                      const eligible = line.itc_eligible !== false;
                      return (
                        <TableRow key={line.key}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={line.includedInGstr9}
                              disabled={!eligible}
                              onChange={(event) => updateLine(line, event.target.checked)}
                              aria-label={`Include ${line.invoice_no} in GSTR-9`}
                            />
                          </TableCell>
                          <TableCell className="min-w-[180px]">
                            <div className="font-medium">{line.supplier_name || "—"}</div>
                            <div className="text-[11px] text-muted-foreground">{line.supplier_gstin}</div>
                          </TableCell>
                          <TableCell>{line.invoice_no || "—"}</TableCell>
                          <TableCell>{line.invoice_date || "—"}</TableCell>
                          <TableCell>{line.match_status === "NOT_IN_BOOKS" ? "Not in Books" : line.match_status === "BOOKS_VALUE_MISMATCH" ? "Books value mismatch" : line.match_status === "MATCHED_WITH_TOLERANCE" ? "Matched ± tolerance" : "Matched"}</TableCell>
                          <TableCell>{eligible ? "Eligible" : `Ineligible${line.itc_reason ? ` — ${line.itc_reason}` : ""}`}</TableCell>
                          <TableCell className="text-right">{money(line.itc_paise / 100)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-md border p-3 text-sm"><div className="text-muted-foreground">Eligible Regular B2B ITC</div><div className="font-semibold">{money(reconciliation.regularB2b.filter((x) => x.itc_eligible !== false).reduce((sum, x) => sum + x.itc_paise, 0) / 100)}</div></div>
                <div className="rounded-md border p-3 text-sm"><div className="text-muted-foreground">Excluded from GSTR-9</div><div className="font-semibold">{money(reconciliation.excludedRegularB2bTotals.itc_paise / 100)}</div></div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm"><div className="text-muted-foreground">GSTR-9 Table 8A working credit</div><div className="text-lg font-semibold">{money(reconciliation.table8AWorkingPaise / 100)}</div></div>
              </div>

              <div className="mt-3 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <strong>Important:</strong> “Not in Books” and “Excluded from GSTR-9” are different statuses. Unticking an invoice does not delete it from GSTR-2B; it only removes its ITC from the GSTR-9 working credit.
              </div>
            </>
          )}
        </CardContent>

        <div className="flex-none border-t bg-background px-4 py-3">
          {message && <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">Save stores the checkbox decisions and updates GSTR-9 Table 8A working credit.</div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void save()} disabled={saving || loading || !!error}>
                <Save className="mr-1 h-4 w-4" /> {saving ? "Saving…" : "Save Reconciliation"}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}


interface Gstr2bPrintSummaryRow {
  period: string;
  regularB2bEligible: number;
  rcmEligible: number;
  cdnrAdjustment: number;
  ineligibleItc: number;
  eligibleItcNet: number;
}

function buildGstr2bPrintSummary(
  rows: Array<{
    section?: "B2B" | "RCM" | "CDNR";
    gstr2b_period?: string | null;
    invoice_date?: string | null;
    igst_paise: number;
    cgst_paise: number;
    sgst_paise: number;
    cess_paise: number;
    itc_eligible?: boolean | null;
  }>,
  financialYear: string,
): Gstr2bPrintSummaryRow[] {
  const match = /^(\d{4})-(\d{2})$/.exec(financialYear);
  const startYear = match ? Number(match[1]) : new Date().getFullYear();
  const monthNames = Array.from({ length: 12 }, (_, index) => {
    const year = index < 9 ? startYear : startYear + 1;
    const month = index < 9 ? index + 4 : index - 8;
    return new Date(year, month - 1, 1).toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });

  const normalisePeriod = (value: string | null | undefined, invoiceDate: string | null | undefined) => {
    const raw = String(value ?? "").trim();
    if (raw) {
      const matched = monthNames.find((month) => month.toLowerCase() === raw.toLowerCase());
      if (matched) return matched;
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString("en-IN", { month: "long", year: "numeric" });
      }
    }
    if (invoiceDate) {
      const parsed = new Date(invoiceDate);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleString("en-IN", { month: "long", year: "numeric" });
      }
    }
    return "Unspecified";
  };

  const byPeriod = new Map<string, Gstr2bPrintSummaryRow>();
  for (const period of monthNames) {
    byPeriod.set(period, {
      period,
      regularB2bEligible: 0,
      rcmEligible: 0,
      cdnrAdjustment: 0,
      ineligibleItc: 0,
      eligibleItcNet: 0,
    });
  }

  for (const row of rows) {
    const period = normalisePeriod(row.gstr2b_period, row.invoice_date);
    const existing = byPeriod.get(period) ?? {
      period,
      regularB2bEligible: 0,
      rcmEligible: 0,
      cdnrAdjustment: 0,
      ineligibleItc: 0,
      eligibleItcNet: 0,
    };
    const itc = (Number(row.igst_paise) + Number(row.cgst_paise) + Number(row.sgst_paise) + Number(row.cess_paise)) / 100;
    const section = row.section ?? "B2B";

    if (row.itc_eligible === false) {
      existing.ineligibleItc += Math.abs(itc);
    } else if (section === "RCM") {
      existing.rcmEligible += itc;
      existing.eligibleItcNet += itc;
    } else if (section === "CDNR") {
      existing.cdnrAdjustment += itc;
      existing.eligibleItcNet += itc;
    } else {
      existing.regularB2bEligible += itc;
      existing.eligibleItcNet += itc;
    }

    byPeriod.set(period, existing);
  }

  return Array.from(byPeriod.values()).filter((row) =>
    row.regularB2bEligible !== 0 ||
    row.rcmEligible !== 0 ||
    row.cdnrAdjustment !== 0 ||
    row.ineligibleItc !== 0,
  );
}

function OfficialTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow>{columns.map((column) => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={`${title}-${index}`}>
                {row.map((cell, cellIndex) => <TableCell key={`${index}-${cellIndex}`} className={cellIndex > 0 ? "text-right" : "font-medium"}>{cell}</TableCell>)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Gstr9PurchaseRegisterSource({
  record,
  financialYear,
  companyId,
  onSaved,
}: {
  record: Gstr9InputRecord | undefined;
  financialYear: string;
  companyId: string;
  onSaved: (record: Gstr9InputRecord) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imported = record?.purchaseRegister;

  const saveImport = async (parsed: Gstr9PurchaseRegisterImport) => {
    const next: Gstr9InputRecord = {
      ...(record ?? {
        id: `${companyId}:${financialYear}`,
        companyId,
        financialYear,
      }),
      purchaseRegister: parsed,
    };
    await saveGstr9InputRecord(next);
    onSaved(next);
    setMessage(`Imported ${parsed.lines.length} purchase-register rows from ${parsed.fileName}. Accounting vouchers were not changed.`);
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const lower = file.name.toLowerCase();
      const parsed = lower.endsWith(".json")
        ? parseGstr9PurchaseRegisterJson(await file.text(), file.name)
        : parseGstr9PurchaseRegisterExcel(await file.arrayBuffer(), file.name);
      if (!parsed.lines.length) throw new Error("No purchase-register rows were found in the selected file.");
      await saveImport(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import Purchase Register.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-5 print:hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Books source — Purchase Register fallback</CardTitle>
        <p className="text-xs text-muted-foreground">
          Smart Accountant Books remain the primary Books source. If Books are not ready, import the Purchase Register as Excel/JSON for GSTR-9 reconciliation only. This import never creates or changes accounting vouchers.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/40">
            <Upload className="mr-2 h-4 w-4" />
            {busy ? "Importing…" : "Import Purchase Register Excel / JSON"}
            <input type="file" accept=".xlsx,.xls,.xlsm,.json" className="hidden" disabled={busy} onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void onFile(file);
            }} />
          </label>
          {imported && <span className="text-xs text-muted-foreground">Imported: {imported.fileName} · {imported.lines.length} rows</span>}
        </div>
        {imported && (
          <div className="grid gap-2 md:grid-cols-5 rounded-md border bg-muted/20 p-3 text-xs">
            <div><span className="text-muted-foreground">Taxable</span><div className="font-semibold">{money(imported.totals.taxableValue)}</div></div>
            <div><span className="text-muted-foreground">IGST</span><div className="font-semibold">{money(imported.totals.igst)}</div></div>
            <div><span className="text-muted-foreground">CGST</span><div className="font-semibold">{money(imported.totals.cgst)}</div></div>
            <div><span className="text-muted-foreground">SGST</span><div className="font-semibold">{money(imported.totals.sgst)}</div></div>
            <div><span className="text-muted-foreground">Total value</span><div className="font-semibold">{money(imported.totals.totalValue)}</div></div>
          </div>
        )}
        {message && <div className="rounded-md border bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{message}</div>}
        {error && <div className="rounded-md border bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
      </CardContent>
    </Card>
  );
}

function Gstr9PrintInputWorking({
  record,
  financialYear,
  companyId,
  company,
}: {
  record: Gstr9InputRecord | undefined;
  financialYear: string;
  companyId: string;
  company?: CompanyMeta;
}) {
  const [gstr2bSummary, setGstr2bSummary] = useState({ regular: 0, rcm: 0, cdnr: 0, ineligible: 0, selected: 0 });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const latest = await latestGstr2bImport(companyId);
        if (!latest) return;
        const rows = await loadGstr2bImportLines(latest.id);
        let regular = 0, rcm = 0, cdnr = 0, ineligible = 0, selected = 0;
        for (const row of rows) {
          const itc = (Number(row.igst_paise) + Number(row.cgst_paise) + Number(row.sgst_paise) + Number(row.cess_paise)) / 100;
          if (row.itc_eligible === false) { ineligible += Math.abs(itc); continue; }
          const section = row.section ?? "B2B";
          if (section === "RCM") rcm += itc;
          else if (section === "CDNR") cdnr += itc;
          else {
            regular += itc;
            const key = gstr9ItcLineKey({
              section: "B2B",
              supplier_gstin: row.supplier_gstin,
              supplier_name: row.supplier_name ?? "",
              invoice_no: row.invoice_no,
              invoice_date: row.invoice_date,
              invoice_value_paise: row.invoice_value_paise,
              taxable_paise: row.taxable_paise,
              igst_paise: row.igst_paise,
              cgst_paise: row.cgst_paise,
              sgst_paise: row.sgst_paise,
              cess_paise: row.cess_paise,
              rev_charge: false,
              gstr2b_period: row.gstr2b_period ?? null,
              gstr1_period: row.gstr1_period ?? null,
              gstr1_filing_date: row.gstr1_filing_date ?? null,
              source_type: "Stored GSTR-2B",
              is_einvoice_enabled: null,
              invoice_sub_type: row.document_type ?? "",
              is_ecom: null,
              itc_eligible: row.itc_eligible ?? null,
              itc_reason: row.itc_reason ?? null,
              cdnr_no: null,
              cdnr_date: null,
              cdnr_type: null,
            });
            const choice = record?.gstr9ItcInclusionByKey?.[key];
            if (choice !== false) selected += itc;
          }
        }
        if (!cancelled) setGstr2bSummary({ regular, rcm, cdnr, ineligible, selected });
      } catch {
        if (!cancelled) setGstr2bSummary({ regular: 0, rcm: 0, cdnr: 0, ineligible: 0, selected: 0 });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [companyId, financialYear, record?.gstr9ItcInclusionByKey]);

  if (!record) return null;

  const table4 = record.gstr1?.table4;
  const table5 = record.gstr1?.table5;
  const periods = record.gstr3b?.periods ?? [];
  const table6 = record.itcTables?.table6;
  const table7 = record.itcTables?.table7;
  const table8 = record.itcTables?.table8;
  const tax = record.taxPayment?.table9.taxPaid;
  const pr = record.purchaseRegister;

  const fmt = (value: number | undefined) => value == null ? "—" : money(value);
  const totalA = periods.reduce((s, p) => s + p.itc.totalItcAvailed, 0);
  const a1 = table6?.precedingFinancialYearItc ?? 0;
  const a2 = totalA - a1;
  const importGoods = table6?.importOfGoods ?? periods.reduce((s, p) => s + p.itc.table4A1ImportOfGoods, 0);
  const importServices = table6?.importOfServices ?? periods.reduce((s, p) => s + p.itc.table4A2ImportOfServices, 0);
  const rcm = table6?.inwardSuppliesRcm ?? periods.reduce((s, p) => s + p.itc.table4A3Rcm, 0);
  const isd = table6?.inwardSuppliesIsd ?? periods.reduce((s, p) => s + p.itc.table4A4Isd, 0);
  const otherItc = table6?.allOtherItc ?? periods.reduce((s, p) => s + p.itc.table4A5Other, 0);
  const reversal = table7?.total ?? periods.reduce((s, p) => s + p.itcReversal.total, 0);

  return (
    <div className="hidden print:block" style={{ breakBefore: "page" }}>
      <div className="mb-5">
        <h2 className="text-lg font-bold">GSTR-9 — Annual Return Summary</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3 text-xs">
          <div><span className="text-muted-foreground">Legal Name</span><div className="font-semibold">{company?.name ?? "Not available"}</div></div>
          <div><span className="text-muted-foreground">GSTIN</span><div className="font-semibold">{company?.gstin ?? "Not available"}</div></div>
          <div><span className="text-muted-foreground">Financial Year</span><div className="font-semibold">{financialYear}</div></div>
        </div>
        <p className="mt-1 text-[8px] text-muted-foreground">Official GSTN/GSTR-9 table structure · Working paper</p>
        <p className="mt-1 text-[9px] text-muted-foreground">Books are the primary Books-side source. {pr ? `Purchase Register fallback imported from ${pr.fileName}; it is a reconciliation source only and does not alter accounting vouchers.` : "If Books are not ready, import the Purchase Register from Excel/JSON on the GSTR-9 screen."}</p>
      </div>

      {table4 && <OfficialTable title="Table 4 — Details of advances, inward and outward supplies made during the financial year on which tax is payable" columns={["Row", "Taxable Value", "Central Tax", "State / UT Tax", "Integrated Tax", "Cess"]} rows={[
        ["4A — Supplies made to un-registered persons (B2C)", fmt(table4.b2cOther.taxableValue), fmt(table4.b2cOther.cgst), fmt(table4.b2cOther.sgst), fmt(table4.b2cOther.igst), fmt(table4.b2cOther.cess)],
        ["4B — Supplies made to registered persons (B2B)", fmt(table4.b2b.taxableValue), fmt(table4.b2b.cgst), fmt(table4.b2b.sgst), fmt(table4.b2b.igst), fmt(table4.b2b.cess)],
        ["4C — Zero rated supply (Export) on payment of tax", fmt(table4.exportsWithPayment.taxableValue), fmt(table4.exportsWithPayment.cgst), fmt(table4.exportsWithPayment.sgst), fmt(table4.exportsWithPayment.igst), fmt(table4.exportsWithPayment.cess)],
        ["4D — Supply to SEZs on payment of tax", fmt(table4.sezWithPayment.taxableValue), fmt(table4.sezWithPayment.cgst), fmt(table4.sezWithPayment.sgst), fmt(table4.sezWithPayment.igst), fmt(table4.sezWithPayment.cess)],
        ["4E — Deemed Exports", fmt(table4.deemedExports.taxableValue), fmt(table4.deemedExports.cgst), fmt(table4.deemedExports.sgst), fmt(table4.deemedExports.igst), fmt(table4.deemedExports.cess)],
        ["4F — Advances on which tax has been paid but invoice has not been issued", fmt(table4.advancesTaxPaid.taxableValue), fmt(table4.advancesTaxPaid.cgst), fmt(table4.advancesTaxPaid.sgst), fmt(table4.advancesTaxPaid.igst), fmt(table4.advancesTaxPaid.cess)],
        ["4G — Inward supplies on which tax is to be paid on reverse charge basis", fmt(table4.inwardSuppliesRcm.taxableValue), fmt(table4.inwardSuppliesRcm.cgst), fmt(table4.inwardSuppliesRcm.sgst), fmt(table4.inwardSuppliesRcm.igst), fmt(table4.inwardSuppliesRcm.cess)],
        ["4G1 — Supplies on which e-commerce operator is required to pay tax u/s 9(5)", "—", "—", "—", "—", "—"],
        ["4H — Sub-total (A to G1)", fmt(table4.total.taxableValue), fmt(table4.total.cgst), fmt(table4.total.sgst), fmt(table4.total.igst), fmt(table4.total.cess)],
        ["4I — Credit Notes (-)", "—", "—", "—", "—", "—"],
        ["4J — Debit Notes (+)", "—", "—", "—", "—", "—"],
        ["4K — Supplies / tax declared through Amendments (+)", "—", "—", "—", "—", "—"],
        ["4L — Supplies / tax reduced through Amendments (-)", "—", "—", "—", "—", "—"],
        ["4M — Sub-total (I to L)", "—", "—", "—", "—", "—"],
        ["4N — Supplies and advances on which tax is to be paid (H + M)", "—", "—", "—", "—", "—"],
      ]} />}

      {table5 && <OfficialTable title="Table 5 — Details of outward supplies made during the financial year on which tax is not payable" columns={["Row", "Taxable Value", "Central Tax", "State / UT Tax", "Integrated Tax", "Cess"]} rows={[
        ["5A — Zero rated supply (Export) without payment of tax", fmt(table5.exportsWithoutPayment.taxableValue), fmt(table5.exportsWithoutPayment.cgst), fmt(table5.exportsWithoutPayment.sgst), fmt(table5.exportsWithoutPayment.igst), fmt(table5.exportsWithoutPayment.cess)],
        ["5B — Supply to SEZs without payment of tax", fmt(table5.sezWithoutPayment.taxableValue), fmt(table5.sezWithoutPayment.cgst), fmt(table5.sezWithoutPayment.sgst), fmt(table5.sezWithoutPayment.igst), fmt(table5.sezWithoutPayment.cess)],
        ["5C — Supplies on which tax is to be paid by recipient", fmt(table5.suppliesOnWhichTaxPayableByRecipient.taxableValue), fmt(table5.suppliesOnWhichTaxPayableByRecipient.cgst), fmt(table5.suppliesOnWhichTaxPayableByRecipient.sgst), fmt(table5.suppliesOnWhichTaxPayableByRecipient.igst), fmt(table5.suppliesOnWhichTaxPayableByRecipient.cess)],
        ["5D — Exempted", fmt(table5.exemptSupplies.taxableValue), fmt(table5.exemptSupplies.cgst), fmt(table5.exemptSupplies.sgst), fmt(table5.exemptSupplies.igst), fmt(table5.exemptSupplies.cess)],
        ["5E — Nil Rated", fmt(table5.nilRatedSupplies.taxableValue), fmt(table5.nilRatedSupplies.cgst), fmt(table5.nilRatedSupplies.sgst), fmt(table5.nilRatedSupplies.igst), fmt(table5.nilRatedSupplies.cess)],
        ["5F — Non-GST supply (includes 'no supply')", fmt(table5.nonGstSupplies.taxableValue), fmt(table5.nonGstSupplies.cgst), fmt(table5.nonGstSupplies.sgst), fmt(table5.nonGstSupplies.igst), fmt(table5.nonGstSupplies.cess)],
        ["5G — Sub-total (A to F)", fmt(table5.total.taxableValue), fmt(table5.total.cgst), fmt(table5.total.sgst), fmt(table5.total.igst), fmt(table5.total.cess)],
        ["5H–5L — Notes / amendments", "—", "—", "—", "—", "—"],
        ["5M — Turnover on which tax is not to be paid", fmt(table5.total.taxableValue), "—", "—", "—", "—"],
      ]} />}

      <p className="mb-2 text-[8px] text-muted-foreground">Current GSTR-3B input stores one combined RCM bucket, so the official 6C/6D split is intentionally not fabricated. Combined RCM working value: {fmt(rcm)}.</p>
      <OfficialTable title="Table 6 — Details of ITC availed during the financial year" columns={["Row", "ITC / Amount"]} rows={[
        ["6A — Total amount of input tax credit availed through FORM GSTR-3B", fmt(totalA)],
        ["6A1 — ITC of any preceding financial year availed in the financial year", fmt(a1)],
        ["6A2 — Net ITC of the financial year (A-A1)", fmt(a2)],
        ["6B — Inward supplies other than imports and RCM", fmt(otherItc)],
        ["6C — Inward supplies from unregistered persons liable to RCM", "—"],
        ["6D — Inward supplies from registered persons liable to RCM", "—"],
        ["6E — Import of goods (including supplies from SEZ)", fmt(importGoods)],
        ["6F — Import of services", fmt(importServices)],
        ["6G — ITC received from ISD", fmt(isd)],
        ["6H — Amount of ITC reclaimed", "—"],
        ["6I — Sub-total (B to H)", fmt(a2)],
        ["6J — Difference (I-A2)", "—"],
        ["6K — Transition Credit through TRAN-1", "—"],
        ["6L — Transition Credit through TRAN-2", "—"],
        ["6M — ITC availed through ITC-01, ITC-02 and ITC-02A", "—"],
        ["6N — Sub-total (K to M)", "—"],
        ["6O — Total ITC availed (I + N)", fmt(totalA)],
      ]} />

      <OfficialTable title="Table 7 — Details of ITC Reversed and Ineligible ITC for the financial year" columns={["Row", "Amount"]} rows={[
        ["7A — As per Rule 37", fmt(table7?.reversalUnderRule37)],
        ["7A1 — As per Rule 37A", fmt(table7?.reversalUnderRule37A)],
        ["7A2 — As per Rule 38", fmt(table7?.rule38)],
        ["7B — As per Rule 39", fmt(table7?.rule39)],
        ["7C — As per Rule 42", fmt(table7?.rule42)],
        ["7D — As per Rule 43", fmt(table7?.rule43)],
        ["7E — As per section 17(5)", fmt(table7?.section17_5)],
        ["7F — Reversal of TRAN-I credit", "—"],
        ["7G — Reversal of TRAN-II credit", "—"],
        ["7H1 — Other reversals", fmt(table7?.otherReversals)],
        ["7I — Total ITC Reversed", fmt(reversal)],
        ["7J — Net ITC Available for Utilization (6O - 7I)", fmt(totalA - reversal)],
      ]} />

      <OfficialTable title="Table 8 — Other ITC related information" columns={["Row", "Amount"]} rows={[
        ["8A — ITC as per GSTR-2B [Table 3(I) thereof]", fmt(gstr2bSummary.selected)],
        ["8B — ITC as per sum total of 6(B) above", fmt(otherItc)],
        ["8C — ITC on inward supplies received during FY but availed in next FY", "—"],
        ["8D — Difference [A-(B+C)]", "—"],
        ["8E — ITC available but not availed", fmt(table8?.creditAvailableButNotAvailed)],
        ["8F — ITC available but ineligible", fmt(table8?.creditAvailableIneligible)],
        ["8G — IGST paid on import of goods", "—"],
        ["8H — IGST credit availed on import of goods in FY", fmt(importGoods)],
        ["8H1 — IGST credit availed on import of goods in next FY", "—"],
        ["8I — Difference (G-H-H1)", "—"],
        ["8J — ITC available but not availed on import of goods", "—"],
        ["8K — Total ITC to be lapsed in current FY", fmt(table8?.totalOtherItc)],
      ]} />
      <p className="mb-5 text-[8px] text-muted-foreground">Table 8A shown here is the saved GSTR-2B reconciliation working value. RCM and CDNR remain separate, and “Not in Books” is not treated as “Excluded”. Invoice-level details remain only in the Reconcile ITC screen.</p>

      <OfficialTable title="Table 9 — Details of tax paid as declared in returns filed during the financial year" columns={["Description", "Tax Payable", "Paid through Cash", "Paid through ITC", "Total Tax Paid"]} rows={[
        ["9A — Integrated Tax", fmt(tax?.igst?.taxPayable), fmt(tax?.igst?.paidThroughCash), fmt(tax?.igst?.paidThroughItc), fmt((tax?.igst?.paidThroughCash ?? 0) + (tax?.igst?.paidThroughItc ?? 0))],
        ["9B — Central Tax", fmt(tax?.cgst?.taxPayable), fmt(tax?.cgst?.paidThroughCash), fmt(tax?.cgst?.paidThroughItc), fmt((tax?.cgst?.paidThroughCash ?? 0) + (tax?.cgst?.paidThroughItc ?? 0))],
        ["9C — State/UT Tax", fmt(tax?.sgst?.taxPayable), fmt(tax?.sgst?.paidThroughCash), fmt(tax?.sgst?.paidThroughItc), fmt((tax?.sgst?.paidThroughCash ?? 0) + (tax?.sgst?.paidThroughItc ?? 0))],
        ["9D — Cess", fmt(tax?.cess?.taxPayable), fmt(tax?.cess?.paidThroughCash), fmt(tax?.cess?.paidThroughItc), fmt((tax?.cess?.paidThroughCash ?? 0) + (tax?.cess?.paidThroughItc ?? 0))],
        ["9E — Interest", fmt(tax?.interest), "—", "—", fmt(tax?.interest)],
        ["9F — Late fee", fmt(tax?.lateFee), "—", "—", fmt(tax?.lateFee)],
        ["9G — Penalty", fmt(tax?.penalty), "—", "—", fmt(tax?.penalty)],
        ["9H — Other", fmt(tax?.others), "—", "—", fmt(tax?.others)],
      ]} />

      <OfficialTable title="Tables 10–14 — Transactions of the financial year declared in returns of the next financial year" columns={["Table", "Working value"]} rows={[
        ["10 — Supplies / tax declared through invoices, debit notes or amendments (+)", "Not captured in current GSTR-9 input model"],
        ["11 — Supplies / tax declared through amendments or credit notes (-)", "Not captured in current GSTR-9 input model"],
        ["12 — ITC of the financial year reversed in the next financial year", "Not captured in current GSTR-9 input model"],
        ["13 — ITC of the financial year availed in the next financial year", "Not captured in current GSTR-9 input model"],
        ["14 — Differential tax paid on account of declaration in 10 & 11", "Not captured in current GSTR-9 input model"],
      ]} />

      <OfficialTable title="Tables 15–16 — Other Information" columns={["Table", "Working value"]} rows={[
        ["15 — Particulars of Demands and Refunds", "Not captured in current GSTR-9 input model"],
        ["16 — Information on supplies received from composition taxpayers, deemed supply u/s 143 and goods sent on approval basis", "Not captured in current GSTR-9 input model"],
      ]} />

      <OfficialTable title="Tables 17–18 — HSN Summary" columns={["Table", "Source / status", "Taxable Value", "Tax"]} rows={[
        ["17 — HSN-wise summary of outward supplies", "GSTR-1 HSN detail not retained by current input model", "—", "—"],
        ["18 — HSN-wise summary of inward supplies", "Purchase Register / Books HSN detail not retained by current input model", "—", "—"],
      ]} />
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
  const [gstr3bOpen, setGstr3bOpen] = useState(false);
  const [gstr2bOpen, setGstr2bOpen] = useState(false);
  const [gstr9ItcOpen, setGstr9ItcOpen] = useState(false);
  const [gstr9ItcReconciliationOpen, setGstr9ItcReconciliationOpen] = useState(false);
  const [gstr9TaxPaymentOpen, setGstr9TaxPaymentOpen] = useState(false);

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

          {activeCompanyId && (
            <Gstr9PurchaseRegisterSource
              record={inputRecord}
              financialYear={financialYear}
              companyId={activeCompanyId}
              onSaved={setInputRecord}
            />
          )}

          <Card className="print:hidden">
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
                status={inputStatus.gstr3b}
                actionLabel="Enter / Import"
                onAction={() => setGstr3bOpen(true)}
              />
              <SourceStatus
                label="GSTR-2B"
                status={inputStatus.gstr2b}
                actionLabel="Enter / Import"
                onAction={() => setGstr2bOpen(true)}
              />
              <SourceStatus
                label="GSTR-2B → GSTR-9 reconciliation"
                status={inputRecord?.gstr9ItcInclusionByKey ? "IMPORTED" : inputStatus.gstr2b}
                actionLabel="Reconcile ITC"
                onAction={() => setGstr9ItcReconciliationOpen(true)}
              />
              <SourceStatus
                label="ITC tables"
                status={inputStatus.itcTables}
                actionLabel="Enter / Import"
                onAction={() => setGstr9ItcOpen(true)}
              />
              <SourceStatus
                label="Tax payment data"
                status={inputStatus.taxPayment}
                actionLabel="Enter / Import"
                onAction={() => setGstr9TaxPaymentOpen(true)}
              />
            </CardContent>
          </Card>

          {inputRecord && activeCompanyId && (
            <Gstr9PrintInputWorking
              record={inputRecord}
              financialYear={financialYear}
              companyId={activeCompanyId}
              company={company}
            />
          )}

          <Card className="print:hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Books-derived outward supplies
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TotalsTable rows={outwardRows} />
            </CardContent>
          </Card>

          <Card className="print:hidden">
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

          <Card className="print:hidden">
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

          <Card className="print:hidden">
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

          <Card className="print:hidden">
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
            <Card className="print:hidden">
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
          {gstr3bOpen && activeCompanyId && (
            <Gstr3bInputPanel
              financialYear={financialYear}
              companyId={activeCompanyId}
              existing={inputRecord}
              onClose={() => setGstr3bOpen(false)}
              onSaved={(record) => {
                setInputRecord(record);
                setGstr3bOpen(false);
              }}
            />
          )}
          {gstr2bOpen && activeCompanyId && (
            <Gstr2bInputPanel
              financialYear={financialYear}
              companyId={activeCompanyId}
              existing={inputRecord}
              onClose={() => setGstr2bOpen(false)}
              onSaved={(record) => {
                setInputRecord(record);
                setGstr2bOpen(false);
              }}
            />
          )}
          {gstr9ItcReconciliationOpen && activeCompanyId && (
            <Gstr9ItcReconciliationPanel
              financialYear={financialYear}
              companyId={activeCompanyId}
              existing={inputRecord}
              onClose={() => setGstr9ItcReconciliationOpen(false)}
              onSaved={(record) => {
                setInputRecord(record);
                setGstr9ItcReconciliationOpen(false);
              }}
            />
          )}
          {gstr9ItcOpen && activeCompanyId && (
            <Gstr9ItcInputPanel
              financialYear={financialYear}
              companyId={activeCompanyId}
              existing={inputRecord}
              onClose={() => setGstr9ItcOpen(false)}
              onSaved={(record) => {
                setInputRecord(record);
                setGstr9ItcOpen(false);
              }}
            />
          )}
          {gstr9TaxPaymentOpen && activeCompanyId && (
            <Gstr9TaxPaymentInputPanel
              financialYear={financialYear}
              companyId={activeCompanyId}
              existing={inputRecord}
              onClose={() => setGstr9TaxPaymentOpen(false)}
              onSaved={(record) => {
                setInputRecord(record);
                setGstr9TaxPaymentOpen(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}