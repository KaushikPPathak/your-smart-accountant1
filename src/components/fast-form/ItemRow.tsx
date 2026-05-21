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
import { formatINR } from "@/lib/money";
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
            size="sm"
            className="h-9 shrink-0 gap-1"
            title="New item (F4)"
            onClick={() => onAddItemDlg(idx)}
          >
            <PackagePlus className="h-4 w-4" /> Add
          </Button>
          {row.item_id && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 shrink-0 gap-1"
              title="Edit item (Shift+F4)"
              onClick={() => onEditItemDlg(idx, row.item_id)}
            >
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </TableCell>
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
            className="h-9 min-w-20 text-right font-mono text-foreground"
            type="text"
            inputMode="decimal"
            autoComplete="off"
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
          className="h-9 min-w-24 text-right font-mono text-foreground"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={row.rate}
          onChange={(e) => onCommit(idx, { rate: cleanDecimal(e.target.value) })}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => commitOnEnter(e, "rate")}
        />
      </TableCell>
      <TableCell>
        <Input
          ref={discRef}
          className="h-9 min-w-20 text-right font-mono text-foreground"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={row.discount}
          onChange={(e) => onCommit(idx, { discount: cleanDecimal(e.target.value) })}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => commitOnEnter(e, "discount")}
        />
      </TableCell>
      <TableCell>
        <Select
          value={row.gst_rate}
          onValueChange={(v) => {
            onCommit(idx, { gst_rate: v });
            // After picking a GST rate, advance to next row (or append a new one).
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
      <TableCell className="text-right font-mono text-sm">{formatINR(amountPaise)}</TableCell>
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
    prev.showDescription === next.showDescription
  );
});
