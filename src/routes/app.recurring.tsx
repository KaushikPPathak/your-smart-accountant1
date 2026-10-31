import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, RefreshCw } from "lucide-react";
import { offlineDb } from "@/lib/offline/db";
import { useCompany } from "@/lib/company-context";
import { toast } from "sonner";

export const Route = createFileRoute("/app/recurring")({
  head: () => ({ meta: [{ title: "Recurring Invoices — Your Mehtaji" }] }),
  component: RecurringPage,
});

interface RecurRow {
  id: string; name: string; voucher_type: string; frequency: string;
  next_run_date: string; end_date: string | null; is_active: boolean;
  last_generated_at: string | null;
}

function RecurringPage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<RecurRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!activeCompanyId) return;
    setLoading(true);
    // Local-only: templates live in this PC's books.
    const all: any[] = await offlineDb.cache_recurring_invoices.where("company_id").equals(activeCompanyId).toArray();
    const list = all
      .filter((r) => !r.deleted_at)
      .map((r) => ({
        id: String(r.id), name: String(r.name ?? ""), voucher_type: String(r.voucher_type ?? ""),
        frequency: String(r.frequency ?? ""), next_run_date: String(r.next_run_date ?? ""),
        end_date: r.end_date ?? null, is_active: Boolean(r.is_active),
        last_generated_at: r.last_generated_at ?? null,
      }))
      .sort((a, b) => a.next_run_date.localeCompare(b.next_run_date));
    setRows(list as RecurRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, [activeCompanyId]);

  async function toggleActive(id: string, current: boolean) {
    const n = await offlineDb.cache_recurring_invoices.update(id, { is_active: !current, updated_at: new Date().toISOString() });
    if (!n) { toast.error("Template not found on this PC"); return; }
    toast.success(current ? "Paused" : "Resumed");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Recurring Invoices</h1>
          <p className="text-xs text-muted-foreground">
            Templates that auto-generate invoices on a schedule. Use &quot;Generate now&quot; on any due row to create the next voucher.
          </p>
        </div>
        <Button asChild size="sm"><Link to="/app/vouchers/new/sales"><Plus className="h-4 w-4 mr-1" />New invoice from template</Link></Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Template</TableHead><TableHead>Type</TableHead><TableHead>Frequency</TableHead>
              <TableHead>Next run</TableHead><TableHead>Last generated</TableHead>
              <TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">Loading…</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                  No recurring templates yet. Create a sales invoice and use &quot;Save as recurring&quot; (coming soon) — or insert one via the database.
                </TableCell></TableRow>
              ) : rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{r.voucher_type}</Badge></TableCell>
                  <TableCell className="capitalize">{r.frequency}</TableCell>
                  <TableCell className="font-mono text-xs">{r.next_run_date}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.last_generated_at?.split("T")[0] ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Paused"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(r.id, r.is_active)}>
                      <RefreshCw className="h-3 w-3 mr-1" />{r.is_active ? "Pause" : "Resume"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p><strong>Quotation → Sales Order → Delivery Note → Invoice</strong> workflow is enabled in the database.</p>
          <p>Create a quotation from <Link to="/app/vouchers/new/sales" className="underline">New Sales</Link> and convert it as you progress through the cycle.</p>
        </CardContent>
      </Card>
    </div>
  );
}
