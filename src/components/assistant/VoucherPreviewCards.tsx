import React from "react";
import { Button } from "@/components/ui/button";
import { Check, Edit2, X, FileText, FileSpreadsheet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { LocalVoucherDraft as ParsedVoucher, VoucherAction } from "@/lib/ai/voucher-actions";

export function VoucherPreviewCard({
  draft,
  action,
  disabled,
  onConfirm,
  onEdit,
  onCancel,
}: {
  draft: ParsedVoucher;
  action?: VoucherAction;
  disabled: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const formattedAmount = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(draft.amount);
  const isReverse = action?.kind === "reverse";
  const isDuplicate = action?.kind === "duplicate";

  const rows: Array<[string, string | undefined]> = [
    ["Voucher Type", isReverse ? `REVERSAL of ${action?.source?.type}` : isDuplicate ? `COPY of ${action?.source?.type}` : draft.intent.toUpperCase()],
    ["Date", draft.date],
    ["Amount", formattedAmount],
    ["Party / Debit", draft.displayDetails?.partyName || "Auto-resolve"],
    ["Account / Credit", draft.displayDetails?.accountName || "Auto-resolve"],
    ["Narration", draft.narration],
    ["Ref / Invoice No", draft.refNo],
  ];

  return (
    <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <FileSpreadsheet className={`h-4 w-4 ${isReverse ? "text-amber-500" : isDuplicate ? "text-blue-500" : "text-emerald-500"}`} />
        <span className={`text-xs font-semibold ${isReverse ? "text-amber-600" : isDuplicate ? "text-blue-600" : "text-emerald-600"} dark:text-emerald-400`}>
          {isReverse ? "Reversal Preview" : isDuplicate ? "Duplicate Preview" : "Transaction Draft Preview"}
        </span>
        {action && (
          <Badge variant="outline" className="ml-auto text-[10px]">
            {(action.confidence * 100).toFixed(0)}% match
          </Badge>
        )}
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words font-medium">{v ? v : <span className="text-muted-foreground">—</span>}</dd>
          </div>
        ))}
      </dl>
      {!disabled ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {isReverse ? "Compensating entry has been prepared." : isDuplicate ? "Copy prepared with today's date." : "This draft has been actioned."}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={onConfirm}>
            <Check className="h-3 w-3" /> {isReverse ? "Post Reversal" : isDuplicate ? "Post Copy" : "Save Instantly"}
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onEdit}>
            <Edit2 className="h-3 w-3" /> Edit in Form
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onCancel}>
            <X className="h-3 w-3" /> Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

export function OcrPreviewCard({
  draft,
  disabled,
  onConfirm,
  onCancel,
}: {
  draft: any;
  disabled: boolean;
  onConfirm: (opts: any) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-amber-500/20 bg-amber-500/5">
      <div className="flex items-center justify-between border-b border-amber-500/10 bg-amber-500/10 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-700">
          <FileText className="h-3.5 w-3.5" />
          Scanned Document
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={onCancel} disabled={disabled}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="p-3 text-xs">
        <div className="mb-2 text-muted-foreground italic">
          Detected a {draft.type || "document"} for ₹{draft.total?.toLocaleString()}.
        </div>
        <Button className="w-full gap-2" variant="outline" size="sm" onClick={() => onConfirm({})} disabled={disabled}>
          Create Voucher
        </Button>
      </div>
    </div>
  );
}
