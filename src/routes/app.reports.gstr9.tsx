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
  const [tab, setTab] = useState<"MANUAL" | "IMPORT">("MANUAL");
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
  const [sourceName, setSourceName] = useState(existingGstr3b?.metadata.sourceName ?? "Filed GSTR-3B");
  const [sourceReference, setSourceReference] = useState(existingGstr3b?.metadata.sourceReference ?? "");
  const [notes, setNotes] = useState(existingGstr3b?.metadata.notes ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updatePeriod = (index: number, updater: (current: Gstr9Gstr3bPeriod) => Gstr9Gstr3bPeriod) => {
    setPeriods((current) => current.map((period, periodIndex) =>
      periodIndex === index ? updater(period) : period,
    ));
  };

  const save = async (source: Gstr9InputSource) => {
    setSaving(true);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      const metadata: Gstr9InputMetadata = {
        source,
        enteredAt: existingGstr3b?.metadata.enteredAt ?? now,
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
        gstr3b: { periods, metadata },
      };
      await saveGstr9InputRecord(record);
      onSaved(record);
      setMessage(`${source === "IMPORT" ? "Imported" : "Manual entry"} saved successfully.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save GSTR-3B input.");
    } finally {
      setSaving(false);
    }
  };

  const importJson = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const imported = normaliseGstr3bImport(parsed, financialYear);
      setPeriods(imported.periods);
      if (imported.sourceName) setSourceName(imported.sourceName);
      if (imported.sourceReference) setSourceReference(imported.sourceReference);
      if (imported.notes) setNotes(imported.notes);
      setTab("IMPORT");
      setMessage("JSON loaded. Review the values, then click Save imported GSTR-3B.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the JSON file.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-7xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-none flex-row items-center justify-between border-b pb-3">
          <div>
            <CardTitle className="text-base">Filed GSTR-3B Input — FY {financialYear}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter or import monthly GSTR-3B figures. Manual entry and import use the same local GSTR-9 input store.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
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
              <div className="text-sm font-medium">Import GSTR-3B structured JSON</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Import a JSON containing a <code>periods</code> array, or a wrapper containing <code>gstr3b.periods</code>. Periods are matched April-to-March.
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

          <div className="mt-4 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <strong>Tax payment:</strong> IGST, CGST, SGST and Cess are stored as GST tax paid. Interest, late fee, penalty and other payments are captured separately and are not included in GST tax-paid totals.
          </div>

          <div className="mt-5 space-y-3">
            {periods.map((period, index) => (
              <details key={`${period.period}-${index}`} open={index === 0} className="rounded-md border">
                <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{period.period}</summary>
                <div className="space-y-5 border-t p-4">
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outward supplies / tax liability</h3>
                    <TaxAmountFields
                      value={period.outwardTax}
                      onChange={(value) => updatePeriod(index, (current) => ({ ...current, outwardTax: value }))}
                    />
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ITC availed — Table 4(A)</h3>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                      {GSTR3B_ITC_FIELDS.map(([field, label]) => (
                        <label key={field} className="space-y-1">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={period.itc[field]}
                            onChange={(event) => updatePeriod(index, (current) => {
                              const itc = { ...current.itc, [field]: numberValue(event.target.value) };
                              itc.totalItcAvailed =
                                itc.table4A1ImportOfGoods + itc.table4A2ImportOfServices + itc.table4A3Rcm + itc.table4A4Isd + itc.table4A5Other;
                              return { ...current, itc };
                            })}
                            className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 text-right text-xs font-semibold">Total ITC availed: {money(period.itc.totalItcAvailed)}</div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ITC reversals</h3>
                    <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-5">
                      {GSTR3B_REVERSAL_FIELDS.map(([field, label]) => (
                        <label key={field} className="space-y-1">
                          <span className="text-[11px] text-muted-foreground">{label}</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={period.itcReversal[field]}
                            onChange={(event) => updatePeriod(index, (current) => {
                              const itcReversal = { ...current.itcReversal, [field]: numberValue(event.target.value) };
                              itcReversal.total = itcReversal.rule38 + itcReversal.rule42 + itcReversal.rule43 + itcReversal.section17_5 + itcReversal.other;
                              return { ...current, itcReversal };
                            })}
                            className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 text-right text-xs font-semibold">Total ITC reversal: {money(period.itcReversal.total)}</div>
                  </section>

                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tax paid</h3>

                    <div className="space-y-3">
                      {GSTR3B_TAX_PAID_TAX_FIELDS.map(([field, label]) => (
                        <div key={field} className="rounded-md border p-3">
                          <div className="mb-2 text-xs font-semibold">{label}</div>
                          <div className="grid gap-2 md:grid-cols-3">
                            {([
                              ["taxPayable", "Tax payable"],
                              ["paidThroughCash", "Paid through cash"],
                              ["paidThroughItc", "Paid through ITC"],
                            ] as Array<[Gstr9TaxPaidRowField, string]>).map(([rowField, rowLabel]) => (
                              <label key={rowField} className="space-y-1">
                                <span className="text-[11px] text-muted-foreground">{rowLabel}</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={period.taxPaid[field][rowField]}
                                  onChange={(event) => updatePeriod(index, (current) => ({
                                    ...current,
                                    taxPaid: {
                                      ...current.taxPaid,
                                      [field]: {
                                        ...current.taxPaid[field],
                                        [rowField]: numberValue(event.target.value),
                                      },
                                    },
                                  }))}
                                  className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}

                      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
                        {GSTR3B_TAX_PAID_OTHER_FIELDS.map(([field, label]) => (
                          <label key={field} className="space-y-1">
                            <span className="text-[11px] text-muted-foreground">{label}</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={period.taxPaid[field]}
                              onChange={(event) => updatePeriod(index, (current) => ({
                                ...current,
                                taxPaid: { ...current.taxPaid, [field]: numberValue(event.target.value) },
                              }))}
                              className="h-8 w-full rounded-md border bg-background px-2 text-right text-xs"
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              </details>
            ))}
          </div>

          <Gstr3bReviewSummary periods={periods} />
        </CardContent>

        <div className="flex-none border-t bg-background px-4 py-3">
          {message && <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">{message}</div>}
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              Review the totals above, then save. The saved record can be reopened from the GSTR-3B card.
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={() => void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")} disabled={saving}>
                <Save className="mr-1 h-4 w-4" />
                {saving ? "Saving…" : tab === "IMPORT" ? "Save imported GSTR-3B" : "Save manual GSTR-3B"}
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-3 pt-3 pb-20">
      <Card className="flex h-[calc(100vh-92px)] max-h-[calc(100vh-92px)] w-full max-w-6xl flex-col overflow-hidden shadow-xl">
        <CardHeader className="flex flex-none flex-row items-center justify-between border-b pb-3">
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
        <CardContent className="min-h-0 flex-1 overflow-y-auto p-4">
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
        </CardContent>

        <div className="flex flex-none items-center justify-end gap-2 border-t bg-background px-4 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save(tab === "IMPORT" ? "IMPORT" : "MANUAL")} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? "Saving…" : tab === "IMPORT" ? "Save imported GSTR-1" : "Save manual GSTR-1"}
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
