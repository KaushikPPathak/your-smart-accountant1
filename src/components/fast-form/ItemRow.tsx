import { memo, useEffect, useRef } from "react";
import { Pencil, PackagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { Combo } from "@/components/vouchers/Combo";
import { GST_RATES } from "@/lib/constants";

import { useFocusHints } from "./FocusHints";

export interface ItemRowData {
  id: string;
  item_id: string;
  description: string;
  qty: string;
  rate: string;
  discount: string;
  gst_rate: string;
}

interface ItemOpt {
  id: string;
  name: string;
  unit: string;
  hsn_code?: string | null;
}

interface Props {
  idx: number;
  row: ItemRowData;
  amountPaise: number;
  items: ItemOpt[];
  canDelete: boolean;
  onPickItem: (idx: number, itemId: string) => void;
  onCommit: (idx: number, patch: Partial<ItemRowData>) => void;
  onFocusRow: (idx: number) => void;
  onDelete: (idx: number) => void;
  onAddItemDlg: (idx: number) => void;
  onEditItemDlg: (idx: number, itemId: string) => void;
  onAdvanceToNextRow?: (idx: number) => void;
  showDescription?: boolean;
  showGstColumn?: boolean;
  showHsnColumn?: boolean;
  hsnDescriptionFor?: (code: string) => string | undefined;
}

function ItemRowImpl({
  idx,
  row,
  amountPaise,
  items,
  canDelete,
  onPickItem,
  onCommit,
  onFocusRow,
  onDelete,
  onAddItemDlg,
  onEditItemDlg,
  onAdvanceToNextRow,
  showDescription = true,
  showGstColumn = true,
  showHsnColumn = false,
  hsnDescriptionFor,
}: Props) {
  const { setHints, clearHints } = useFocusHints();
  const zone = `item-row`;
  const handleFocus = () => {
    onFocusRow(idx);
    setHints(zone, [
      "Enter: next",
      "F4: new item",
      "Shift+F4: edit item",
      "Ctrl+D: delete row",
      "Ctrl+R: recall narration",
      "Ctrl+S: accept",
    ]);
  };
  const handleBlur = () => clearHints(zone);

  const qtyRef = useRef<HTMLInputElement | null>(null);
  const rateRef = useRef<HTMLInputElement | null>(null);
  const discRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLInputElement | null>(null);
  const selectedItem = items.find((it) => it.id === row.item_id);
  const cleanDecimal = (value: string) => {
    const cleaned = value.replace(/[^0-9.]/g, "");
    const [first, ...rest] = cleaned.split(".");
    return rest.length ? `${first}.${rest.join("")}` : first;
  };

  // Reset uncontrolled inputs when the row id changes (e.g. after voucher accept).
  useEffect(() => {
    if (qtyRef.current) qtyRef.current.value = row.qty;
    if (rateRef.current) rateRef.current.value = row.rate;
    if (discRef.current) discRef.current.value = row.discount;
    if (descRef.current) descRef.current.value = row.description;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>, field: keyof ItemRowData) => {
    if (e.key === "Enter") {
      const v = (e.currentTarget.value ?? "").toString();
      onCommit(idx, { [field]: v } as Partial<ItemRowData>);
    }
  };

  const gstTriggerRef = useRef<HTMLButtonElement | null>(null);

  const handleGstKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "Enter") return;
    const expanded = e.currentTarget.getAttribute("aria-expanded") === "true";
    if (expanded) return; // let Radix handle selection
    if (!row.gst_rate) return; // no value yet — let Radix open
    e.preventDefault();
    e.stopPropagation();
    onAdvanceToNextRow?.(idx);
  };

  return (
    <TableRow
      data-voucher-row
      data-row-idx={idx}
      onFocusCapture={handleFocus}
      onBlurCapture={handleBlur}
      onClick={() => onFocusRow(idx)}
    >
      <TableCell>
        <div className="flex gap-1">
          <Combo
            className="flex-1"
            value={row.item_id}
            onChange={(v) => {
              onFocusRow(idx);
              onPickItem(idx, v);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  qtyRef.current?.focus();
                  qtyRef.current?.select();
                });
              });
            }}
            options={items.map((it) => ({ value: it.id, label: it.name, hint: it.unit }))}
            placeholder="Select item"
            emptyText="No items — Alt+C to create"
            onCreate={() => onAddItemDlg(idx)}
            createLabel="New item"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="New item (F4)"
            onClick={() => onAddItemDlg(idx)}
          >
            <PackagePlus className="h-4 w-4" />
          </Button>
          {row.item_id && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              title="Edit item (Shift+F4)"
              onClick={() => onEditItemDlg(idx, row.item_id)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
      {showHsnColumn && (
        <TableCell className="align-middle">
          {(() => {
            const code = (selectedItem as ItemOpt | undefined)?.hsn_code || "";
            const desc = code ? hsnDescriptionFor?.(code) : undefined;
            return (
              <div className="flex flex-col leading-tight" title={desc || code || "No HSN"}>
                <span className="font-mono text-xs">{code || "—"}</span>
                {desc && (
                  <span className="truncate text-[10px] text-muted-foreground max-w-[14rem]">
                    {desc}
                  </span>
                )}
              </div>
            );
          })()}
        </TableCell>
      )}
      {showDescription && (
        <TableCell>
          <Input
            ref={descRef}
            className="h-9"
            defaultValue={row.description}
            onBlur={(e) => onCommit(idx, { description: e.target.value })}
            onKeyDown={(e) => commitOnEnter(e, "description")}
          />
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center gap-1">
          <Input
            ref={qtyRef}
            data-voucher-qty
            className="h-9 w-20 text-right font-mono text-foreground"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            maxLength={12}
            value={row.qty}
            onChange={(e) => onCommit(idx, { qty: cleanDecimal(e.target.value) })}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => commitOnEnter(e, "qty")}
          />
          <span
            className="min-w-10 truncate text-xs text-muted-foreground"
            title={selectedItem?.unit || undefined}
          >
            {selectedItem?.unit || "—"}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <Input
          ref={rateRef}
          className="h-9 w-20 text-right font-mono text-foreground"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={12}
          value={row.rate}
          onChange={(e) => onCommit(idx, { rate: cleanDecimal(e.target.value) })}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => commitOnEnter(e, "rate")}
        />
      </TableCell>
      <TableCell>
        <Input
          ref={discRef}
          className="h-9 w-16 text-right font-mono text-foreground"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={10}
          value={row.discount}
          onChange={(e) => onCommit(idx, { discount: cleanDecimal(e.target.value) })}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !showGstColumn) {
              e.preventDefault();
              onCommit(idx, { discount: e.currentTarget.value });
              onAdvanceToNextRow?.(idx);
              return;
            }
            commitOnEnter(e, "discount");
          }}
        />
      </TableCell>
      {showGstColumn && (
        <TableCell>
          <Select
            value={row.gst_rate}
            onValueChange={(v) => {
              onCommit(idx, { gst_rate: v });
              requestAnimationFrame(() => onAdvanceToNextRow?.(idx));
            }}
          >
            <SelectTrigger ref={gstTriggerRef} className="h-9" onKeyDown={handleGstKeyDown}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GST_RATES.map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
      )}
      <TableCell className="text-right">
        <Input
          key={`amt-${row.id}-${amountPaise}`}
          className="h-9 w-28 text-right font-mono text-foreground"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          maxLength={14}
          defaultValue={(amountPaise / 100).toFixed(2)}
          onFocus={(e) => e.currentTarget.select()}
          title="Type a final amount (incl. GST) to back-calculate the rate"
          onBlur={(e) => {
            const v = parseFloat(cleanDecimal(e.target.value));
            if (!isFinite(v) || v < 0) return;
            const qty = parseFloat(row.qty) || 0;
            if (qty <= 0) return;
            const gst = parseFloat(row.gst_rate) || 0;
            const disc = parseFloat(row.discount) || 0;
            const targetPaise = Math.round(v * 100);
            if (targetPaise === amountPaise) return;
            const taxablePaise = Math.round(targetPaise / (1 + gst / 100));
            const discPaise = Math.round(disc * 100);
            const ratePaisePerUnit = (taxablePaise + discPaise) / qty;
            const rate = (ratePaisePerUnit / 100).toFixed(4).replace(/\.?0+$/, "");
            onCommit(idx, { rate: rate || "0" });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
              onAdvanceToNextRow?.(idx);
            }
          }}
        />
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(idx)}
          disabled={!canDelete}
          title="Delete row (Ctrl+D)"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export const ItemRow = memo(ItemRowImpl, (prev, next) => {
  return (
    prev.idx === next.idx &&
    prev.row === next.row &&
    prev.amountPaise === next.amountPaise &&
    prev.items === next.items &&
    prev.canDelete === next.canDelete &&
    prev.showDescription === next.showDescription &&
    prev.showGstColumn === next.showGstColumn
  );
});
