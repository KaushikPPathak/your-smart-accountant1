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
}

function ItemRowImpl({
  idx, row, amountPaise, items, canDelete,
  onPickItem, onCommit, onFocusRow, onDelete, onAddItemDlg, onEditItemDlg,
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

  return (
    <TableRow onFocusCapture={handleFocus} onBlurCapture={handleBlur} onClick={() => onFocusRow(idx)}>
      <TableCell>
        <div className="flex gap-1">
          <Combo
            className="flex-1"
            value={row.item_id}
            onChange={(v) => { onFocusRow(idx); onPickItem(idx, v); }}
            options={items.map((it) => ({ value: it.id, label: it.name, hint: it.unit }))}
            placeholder="Select item"
            emptyText="No items — Alt+C to create"
            onCreate={() => onAddItemDlg(idx)}
            createLabel="New item"
          />
          <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1" title="New item (F4)" onClick={() => onAddItemDlg(idx)}>
            <PackagePlus className="h-4 w-4" /> Add
          </Button>
          {row.item_id && (
            <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1" title="Edit item (Shift+F4)" onClick={() => onEditItemDlg(idx, row.item_id)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Input
          ref={descRef}
          className="h-9"
          defaultValue={row.description}
          onBlur={(e) => onCommit(idx, { description: e.target.value })}
          onKeyDown={(e) => commitOnEnter(e, "description")}
        />
      </TableCell>
      <TableCell>
        <Input
          ref={qtyRef}
          className="h-9"
          type="number"
          step="0.01"
          defaultValue={row.qty}
          onBlur={(e) => onCommit(idx, { qty: e.target.value })}
          onKeyDown={(e) => commitOnEnter(e, "qty")}
        />
      </TableCell>
      <TableCell>
        <Input
          ref={rateRef}
          className="h-9"
          type="number"
          step="0.01"
          defaultValue={row.rate}
          onBlur={(e) => onCommit(idx, { rate: e.target.value })}
          onKeyDown={(e) => commitOnEnter(e, "rate")}
        />
      </TableCell>
      <TableCell>
        <Input
          ref={discRef}
          className="h-9"
          type="number"
          step="0.01"
          defaultValue={row.discount}
          onBlur={(e) => onCommit(idx, { discount: e.target.value })}
          onKeyDown={(e) => commitOnEnter(e, "discount")}
        />
      </TableCell>
      <TableCell>
        <Select
          value={row.gst_rate}
          onValueChange={(v) => onCommit(idx, { gst_rate: v })}
        >
          <SelectTrigger className="h-9">
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
      <TableCell className="text-right font-mono text-sm">
        {formatINR(amountPaise)}
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" onClick={() => onDelete(idx)} disabled={!canDelete} title="Delete row (Ctrl+D)">
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
    prev.canDelete === next.canDelete
  );
});
