import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import offlineDb from "@/lib/offline/db";
import { useCompany } from "@/lib/company-context";

export const Route = createFileRoute("/app/settings/cost-centres")({
  head: () => ({ meta: [{ title: "Cost centres — Settings" }] }),
  component: CostCentresPage,
});

interface Row {
  id: string;
  company_id: string;
  name: string;
  code?: string | null;
  is_active: boolean;
  updated_at: string;
}

type Kind = "centre" | "category";

const TABLE: Record<Kind, string> = {
  centre: "cache_cost_centres",
  category: "cache_cost_categories",
};

function CostCentresPage() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const [centres, setCentres] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; kind: Kind; editing: Row | null }>({
    open: false, kind: "centre", editing: null,
  });
  const [draft, setDraft] = useState<{ name: string; code: string }>({ name: "", code: "" });
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!activeCompanyId) { setCentres([]); setCategories([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [cc, cat] = await Promise.all([
        (offlineDb as any).cache_cost_centres.where("company_id").equals(activeCompanyId).toArray(),
        (offlineDb as any).cache_cost_categories.where("company_id").equals(activeCompanyId).toArray(),
      ]);
      const sort = (a: Row, b: Row) => a.name.localeCompare(b.name);
      setCentres((cc as Row[]).sort(sort));
      setCategories((cat as Row[]).sort(sort));
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  const openNew = (kind: Kind) => {
    setDialog({ open: true, kind, editing: null });
    setDraft({ name: "", code: "" });
  };

  const openEdit = (kind: Kind, row: Row) => {
    setDialog({ open: true, kind, editing: row });
    setDraft({ name: row.name, code: row.code ?? "" });
  };

  const save = async () => {
    if (!activeCompanyId) { toast.error("Select a company first"); return; }
    const name = draft.name.trim();
    if (name.length < 2) { toast.error("Name is required"); return; }
    setSaving(true);
    const now = new Date().toISOString();
    const table = (offlineDb as any)[TABLE[dialog.kind]];
    const row: Row = dialog.editing
      ? { ...dialog.editing, name, code: draft.code.trim() || null, updated_at: now }
      : {
          id: crypto.randomUUID(),
          company_id: activeCompanyId,
          name,
          code: draft.code.trim() || null,
          is_active: true,
          updated_at: now,
        };
    try {
      await table.put(row);
      toast.success(dialog.editing ? "Updated" : "Created");
      setDialog({ open: false, kind: dialog.kind, editing: null });
      await reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally { setSaving(false); }
  };

  const remove = async (kind: Kind, row: Row) => {
    if (!confirm(`Delete "${row.name}"? Existing vouchers keep their tags.`)) return;
    try {
      await (offlineDb as any)[TABLE[kind]].delete(row.id);
      await reload();
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  };

  const renderPanel = (kind: Kind, rows: Row[], title: string, help: string) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{help}</p>
        </div>
        <Button size="sm" onClick={() => openNew(kind)}>
          <Plus className="h-4 w-4 mr-1" /> New
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">None yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-32">Code</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => openEdit(kind, r)}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.code ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); void remove(kind, r); }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app/settings" })}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Settings
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cost centres &amp; categories</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mt-1 flex items-start gap-2">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          Tag voucher lines to a cost centre (e.g. Branch-Delhi, Project-Alpha) and, optionally,
          a category (e.g. Direct, Overhead). Pickers stay hidden on the voucher form until at
          least one cost centre exists here. Stored on this device only.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderPanel("centre", centres, "Cost centres", "Primary allocation unit — branch, project, cost pool.")}
        {renderPanel("category", categories, "Cost categories (optional)", "Secondary axis — direct/indirect, fixed/variable, etc.")}
      </div>

      <Dialog open={dialog.open} onOpenChange={(o) => setDialog({ ...dialog, open: o })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog.editing ? "Edit" : "New"} {dialog.kind === "centre" ? "cost centre" : "cost category"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="cc-name">Name *</Label>
              <Input
                id="cc-name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                autoFocus
                maxLength={80}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-code">Short code (optional)</Label>
              <Input
                id="cc-code"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                maxLength={12}
                className="font-mono uppercase"
                placeholder="DEL, PRJ-A"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialog({ ...dialog, open: false })}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
