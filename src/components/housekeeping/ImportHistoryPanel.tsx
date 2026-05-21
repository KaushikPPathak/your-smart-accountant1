// Import history + one-click undo / bulk delete panel.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, RotateCcw, Trash2, History } from "lucide-react";
import { toast } from "sonner";
import {
  listImportBatches, deleteImportBatch, bulkDeleteVouchers,
  type ImportBatchRow, type VoucherType,
} from "@/lib/tally-busy-import";

interface Props { companyId: string; disabled?: boolean }

const VTYPES: { value: VoucherType; label: string }[] = [
  { value: "purchase", label: "Purchase" },
  { value: "sales", label: "Sales" },
  { value: "receipt", label: "Receipt" },
  { value: "payment", label: "Payment" },
  { value: "credit_note", label: "Credit Note" },
  { value: "debit_note", label: "Debit Note" },
  { value: "journal", label: "Journal" },
  { value: "contra", label: "Contra" },
];

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function ImportHistoryPanel({ companyId, disabled }: Props) {
  const [batches, setBatches] = useState<ImportBatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [bulkType, setBulkType] = useState<VoucherType>("purchase");
  const [bulkFrom, setBulkFrom] = useState("");
  const [bulkTo, setBulkTo] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listImportBatches(companyId);
      setBatches(rows);
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Could not load history: ${e.message || "unknown"}`);
    } finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { if (companyId) load(); }, [companyId, load]);

  async function undo(batchId: string) {
    setUndoing(batchId);
    try {
      const res = await deleteImportBatch(batchId);
      toast.success(
        `Undone — removed ${res.vouchers} vouchers, ${res.items} items, ${res.ledgers} ledgers`,
      );
      await load();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Undo failed: ${e.message || "Only admins can delete a batch"}`);
    } finally { setUndoing(null); }
  }

  async function runBulk() {
    setBulkBusy(true);
    try {
      const n = await bulkDeleteVouchers(companyId, bulkType, {
        from: bulkFrom || undefined,
        to: bulkTo || undefined,
      });
      toast.success(`Deleted ${n} ${bulkType} vouchers`);
      await load();
    } catch (err) {
      const e = err as { message?: string };
      toast.error(`Bulk delete failed: ${e.message || "Only admins can run this"}`);
    } finally { setBulkBusy(false); }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Import history &amp; Undo
        </CardTitle>
        <CardDescription>
          Every import is tagged so you can roll it back with a single click.
          Use Bulk delete below to wipe an entire voucher type (e.g. all Purchase entries) when needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="text-sm font-medium">Recent imports</Label>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Refresh"}
            </Button>
          </div>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="text-right">Ledgers</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Vouchers</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {batches.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs">{fmtDate(b.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{b.source}</Badge>{" "}
                        <span className="text-xs">{b.label || "—"}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.file_name || "—"}</TableCell>
                      <TableCell className="text-right">{b.ledgers_created}</TableCell>
                      <TableCell className="text-right">{b.items_created}</TableCell>
                      <TableCell className="text-right">{b.vouchers_created}</TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={disabled || undoing === b.id}
                            >
                              {undoing === b.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Undo</>
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Undo this import?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete <b>{b.vouchers_created}</b> vouchers,{" "}
                                <b>{b.items_created}</b> items and <b>{b.ledgers_created}</b> ledgers
                                created on {fmtDate(b.created_at)}. Manual entries you made afterwards are not affected.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => undo(b.id)}>Yes, undo</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="border-t pt-4">
          <Label className="text-sm font-medium">Bulk delete vouchers by type</Label>
          <p className="text-xs text-muted-foreground mb-3">
            Removes every voucher of the chosen type (optionally limited to a date range).
            Locked GST periods are protected. Admin-only.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs">Type</Label>
              <Select value={bulkType} onValueChange={(v) => setBulkType(v as VoucherType)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VTYPES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <FyDatePicker value={bulkFrom} onChange={setBulkFrom} unrestricted className="w-40" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <FyDatePicker value={bulkTo} onChange={setBulkTo} unrestricted className="w-40" />
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={disabled || bulkBusy}>
                  {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Delete all {VTYPES.find((v) => v.value === bulkType)?.label || ""}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete every matching voucher?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete all <b>{bulkType}</b> vouchers
                    {bulkFrom || bulkTo ? ` between ${bulkFrom || "start"} and ${bulkTo || "today"}` : ""}.
                    This cannot be undone. Vouchers inside a locked period will be skipped.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={runBulk}>Yes, delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
