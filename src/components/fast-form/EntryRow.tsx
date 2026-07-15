import { memo, useEffect, useRef } from "react";
import { Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { Combo } from "@/components/vouchers/Combo";
import { formatINR } from "@/lib/money";
import { useFocusHints } from "./FocusHints";

export interface EntryRowData {
  id: string;
  ledger_id: string;
  debit?: string;
  credit?: string;
  amount?: string;
  narration: string;
}

interface LedgerOpt { id: string; name: string; type: string }

interface BalanceInfo { paise: number }

interface CommonProps {
  idx: number;
  row: EntryRowData;
  ledgerOptions: LedgerOpt[];
  balance?: BalanceInfo;
  canDelete: boolean;
  onCommit: (idx: number, patch: Partial<EntryRowData>) => void;
  onFocusRow: (idx: number) => void;
  onDelete: (idx: number) => void;
  onAddLedger: (idx: number) => void;
  onEditLedger: (idx: number, ledgerId: string) => void;
}

interface DoubleProps extends CommonProps { mode: "double" }
interface SimpleProps extends CommonProps { mode: "simple" }

type Props = DoubleProps | SimpleProps;

function EntryRowImpl(props: Props) {
  const { idx, row, ledgerOptions, balance, canDelete, onCommit, onFocusRow, onDelete, onAddLedger, onEditLedger, mode } = props;
  const { setHints, clearHints } = useFocusHints();
  const zone = "entry-row";
  const handleFocus = () => {
    onFocusRow(idx);
    setHints(zone, [
      "Enter: next",
      "F3: new ledger",
      "Shift+F3: edit ledger",
      "Ctrl+D: delete row",
      "Ctrl+R: recall narration",
      "Ctrl+S: accept",
    ]);
  };
  const handleBlur = () => clearHints(zone);

  const dRef = useRef<HTMLInputElement | null>(null);
  const cRef = useRef<HTMLInputElement | null>(null);
  const aRef = useRef<HTMLInputElement | null>(null);
  const nRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Sync uncontrolled inputs when props change, but never stomp the field
    // the user is currently typing in. Lets auto-mirror (debit → credit on
    // the counterpart row) reflect in the DOM.
    const active = document.activeElement;
    if (dRef.current && active !== dRef.current) dRef.current.value = row.debit ?? "";
    if (cRef.current && active !== cRef.current) cRef.current.value = row.credit ?? "";
    if (aRef.current && active !== aRef.current) aRef.current.value = row.amount ?? "";
    if (nRef.current && active !== nRef.current) nRef.current.value = row.narration ?? "";
  }, [row.id, row.debit, row.credit, row.amount, row.narration]);

  return (
    <TableRow onFocusCapture={handleFocus} onBlurCapture={handleBlur} onClick={() => onFocusRow(idx)}>
      <TableCell>
        <div className="flex gap-1">
          <Combo
            className="flex-1"
            value={row.ledger_id}
            onChange={(v) => { onFocusRow(idx); onCommit(idx, { ledger_id: v }); }}
            options={ledgerOptions.map((lg) => ({ value: lg.id, label: lg.name, hint: lg.type }))}
            placeholder="Select ledger"
            emptyText="No ledgers — Alt+C to create"
            onCreate={() => onAddLedger(idx)}
            createLabel="New ledger"
          />
          <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="New ledger (F3)" onClick={() => onAddLedger(idx)}>
            <UserPlus className="h-4 w-4" />
          </Button>
          {row.ledger_id && (
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" title="Edit ledger (Shift+F3)" onClick={() => onEditLedger(idx, row.ledger_id)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
        {row.ledger_id && balance && (
          <div className="mt-1 inline-flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
            <span>Bal:</span>
            <span>{formatINR(Math.abs(balance.paise))}</span>
            <span>{balance.paise >= 0 ? "Dr" : "Cr"}</span>
          </div>
        )}
      </TableCell>
      {mode === "simple" ? (
        <TableCell>
          <Input
            ref={aRef}
            className="h-9 text-right font-mono"
            type="number"
            step="0.01"
            defaultValue={row.amount ?? ""}
            onBlur={(e) => onCommit(idx, { amount: e.target.value })}
          />
        </TableCell>
      ) : (
        <>
          <TableCell>
            <Input
              ref={dRef}
              className="h-9 text-right font-mono"
              type="number"
              step="0.01"
              defaultValue={row.debit ?? ""}
              onBlur={(e) => {
                const v = e.target.value;
                onCommit(idx, { debit: v, ...(v ? { credit: "" } : {}) });
              }}
            />
          </TableCell>
          <TableCell>
            <Input
              ref={cRef}
              className="h-9 text-right font-mono"
              type="number"
              step="0.01"
              defaultValue={row.credit ?? ""}
              onBlur={(e) => {
                const v = e.target.value;
                onCommit(idx, { credit: v, ...(v ? { debit: "" } : {}) });
              }}
            />
          </TableCell>
        </>
      )}
      <TableCell>
        <Input
          ref={nRef}
          className="h-9"
          defaultValue={row.narration}
          onBlur={(e) => onCommit(idx, { narration: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" onClick={() => onDelete(idx)} disabled={!canDelete} title="Delete row (Ctrl+D)">
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export const EntryRow = memo(EntryRowImpl, (prev, next) => {
  return (
    prev.idx === next.idx &&
    prev.row === next.row &&
    prev.balance === next.balance &&
    prev.ledgerOptions === next.ledgerOptions &&
    prev.canDelete === next.canDelete &&
    prev.mode === next.mode
  );
});
