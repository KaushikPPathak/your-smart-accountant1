import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCompany } from "@/lib/company-context";
import { listActivity, isActivityLogEnabled, setActivityLogEnabled, getActivityRetentionDays, setActivityRetentionDays, pruneOldActivity, type ActivityRow } from "@/lib/activity-log";
import { downloadCsv } from "@/lib/csv";
import { toast } from "sonner";

export const Route = createFileRoute("/app/reports/activity-log")({
  head: () => ({ meta: [{ title: "Activity Log — Reports" }] }),
  component: ActivityLogPage,
});

function ActivityLogPage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [enabled, setEnabled] = useState(isActivityLogEnabled());
  const [retention, setRetention] = useState(getActivityRetentionDays());
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const refresh = async () => {
    if (!activeCompanyId) return;
    const r = await listActivity(activeCompanyId, { limit: 2000 });
    setRows(r);
  };
  useEffect(() => { void refresh(); }, [activeCompanyId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (entityFilter !== "all" && r.entity_type !== entityFilter) return false;
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      if (q && !(r.entity_label ?? "").toLowerCase().includes(q) && !(r.note ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, entityFilter, actionFilter, search]);

  const onExport = () => {
    downloadCsv("activity-log.csv", [
      ["Timestamp", "Actor", "Entity type", "Action", "Label", "Note"],
      ...filtered.map(r => [
        new Date(r.ts).toLocaleString(),
        r.actor ?? "",
        r.entity_type,
        r.action,
        r.entity_label ?? "",
        r.note ?? "",
      ]),
    ]);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Activity Log</CardTitle>
          <p className="text-xs text-muted-foreground">
            Lightweight local trail of who edited what. Opt-in and mutable — <strong>not</strong> a Companies-Act audit trail.
            Stored only on this device.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setActivityLogEnabled(e.target.checked); }} />
                Enable activity logging
              </label>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Retention (days)</div>
              <Input type="number" min={7} max={3650} value={retention} className="w-28" onChange={(e) => {
                const v = parseInt(e.target.value, 10) || 90;
                setRetention(v); setActivityRetentionDays(v);
              }} />
            </div>
            <Button variant="outline" size="sm" onClick={async () => { const n = await pruneOldActivity(); toast.success(`Pruned ${n} old entries`); void refresh(); }}>Prune now</Button>
            <Button variant="outline" size="sm" onClick={onExport}>Export CSV</Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All entities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                <SelectItem value="voucher">Vouchers</SelectItem>
                <SelectItem value="ledger">Ledgers</SelectItem>
                <SelectItem value="item">Items</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="settings">Settings</SelectItem>
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All actions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="create">Create</SelectItem>
                <SelectItem value="update">Update</SelectItem>
                <SelectItem value="delete">Delete</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder="Search label or note…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
            <Badge variant="secondary" className="ml-auto self-center">{filtered.length} entries</Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase">
                <tr>
                  <th className="p-2">When</th>
                  <th className="p-2">Actor</th>
                  <th className="p-2">Entity</th>
                  <th className="p-2">Action</th>
                  <th className="p-2">Label</th>
                  <th className="p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No activity recorded in the current window.</td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2 whitespace-nowrap text-xs">{new Date(r.ts).toLocaleString()}</td>
                    <td className="p-2 text-xs">{r.actor ?? "—"}</td>
                    <td className="p-2"><Badge variant="outline">{r.entity_type}</Badge></td>
                    <td className="p-2"><Badge variant={r.action === "delete" ? "destructive" : r.action === "create" ? "default" : "secondary"}>{r.action}</Badge></td>
                    <td className="p-2">{r.entity_label ?? "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground">{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
