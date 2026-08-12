import React from "react";
import { Button } from "@/components/ui/button";
import { Check, Edit2, X, FileText, Loader2 } from "lucide-react";
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
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-primary/20 bg-primary/5">
      <div className="flex items-center justify-between border-b border-primary/10 bg-primary/10 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <FileText className="h-3.5 w-3.5" />
          Draft {draft.intent}
        </div>
        <div className="flex gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onEdit} disabled={disabled}>
            <Edit2 className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={onCancel} disabled={disabled}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="p-3 text-xs">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Date</div>
            <div>{draft.date}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Amount</div>
            <div className="font-mono font-bold">₹{draft.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="col-span-2">
            <div className="text-[10px] uppercase text-muted-foreground">Ledger</div>
            <div className="truncate font-medium">{draft.displayDetails?.partyName || draft.partyLedgerId || "Unknown"}</div>
          </div>
        </div>
        <Button className="mt-3 w-full gap-2" size="sm" onClick={onConfirm} disabled={disabled}>
          <Check className="h-3.5 w-3.5" />
          Post to Books
        </Button>
      </div>
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
  memoryHint?: any;
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
