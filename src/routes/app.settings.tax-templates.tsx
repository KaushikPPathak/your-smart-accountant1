import { toTitleCaseOnType } from "@/lib/text-case";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, ArrowLeft, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { offlineDb } from "@/lib/offline/db";
import { useCompany } from "@/lib/company-context";
import type { TaxTemplate } from "@/lib/voucher-resolver";

export const Route = createFileRoute("/app/settings/tax-templates")({
  head: () => ({ meta: [{ title: "Tax templates — Settings" }] }),
  component: TaxTemplatesPage,
});

type Draft = Omit<TaxTemplate, "id" | "company_id"> & { id?: string };

const EMPTY: Draft = {
  name: "",
  gst_rate: 18,
  cess_rate: 0,
  is_interstate: false,
  itc_eligible: true,
  is_reverse_charge: false,
  hsn_prefix: "",
};

function TaxTemplatesPage() {
  const { activeCompanyId } = useCompany();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TaxTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!activeCompanyId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try {
      const all = await offlineDb.cache_tax_templates
        .where("company_id").equals(activeCompanyId).toArray();
      setRows((all as TaxTemplate[]).sort((a, b) =>
        Number(a.is_interstate) - Number(b.is_interstate) ||
        a.gst_rate - b.gst_rate ||
        a.name.localeCompare(b.name),
      ));
    } finally { setLoading(false); }
  };

  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCompanyId]);

  const openNew = () => { setDraft(EMPTY); setOpen(true); };
  const openEdit = (t: TaxTemplate) => {
    setDraft({
      id: t.id, name: t.name, gst_rate: t.gst_rate, cess_rate: t.cess_rate,
      is_interstate: t.is_interstate, itc_eligible: t.itc_eligible,
      is_reverse_charge: t.is_reverse_charge, hsn_prefix: t.hsn_prefix ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!activeCompanyId) { toast.error("Select a company first"); return; }
    const name = draft.name.trim();
    if (!name) { toast.error("Name is required"); return; }
    if (draft.gst_rate < 0 || draft.gst_rate > 100) { toast.error("GST rate must be 0–100"); return; }
    if (draft.cess_rate < 0 || draft.cess_rate > 100) { toast.error("Cess rate must be 0–100"); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const row: TaxTemplate & { updated_at: string } = {
        id: draft.id ?? crypto.randomUUID(),
        company_id: activeCompanyId,
        name,
        gst_rate: Number(draft.gst_rate),
        cess_rate: Number(draft.cess_rate),
        is_interstate: !!draft.is_interstate,
        itc_eligible: !!draft.itc_eligible,
        is_reverse_charge: !!draft.is_reverse_charge,
        hsn_prefix: draft.hsn_prefix?.trim() ? draft.hsn_prefix.trim() : null,
        updated_at: now,
      };
      await offlineDb.cache_tax_templates.put(row);
      toast.success(draft.id ? "Template updated" : "Template created");
      setOpen(false);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally { setSaving(false); }
  };

  const remove = async (t: TaxTemplate) => {
    if (!confirm(`Delete tax template "${t.name}"?`)) return;
    try {
      await offlineDb.cache_tax_templates.delete(t.id);
      toast.success("Deleted");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/app/settings" })}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Settings
            </Button>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tax templates</h1>
          <p className="text-sm text-muted-foreground">
            Reusable GST/Cess presets. Vouchers auto-apply the matching template silently — a picker
            only appears when more than one template fits the party + item.
          </p>
        </div>
        <Button onClick={openNew} disabled={!activeCompanyId}>
          <Plus className="mr-2 h-4 w-4" /> New template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" /> How resolution works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>1. If an item's HSN starts with a template's <em>HSN prefix</em> and interstate matches — that template wins.</p>
          <p>2. Otherwise, first template whose GST rate equals the item's GST rate and interstate matches — that wins.</p>
          <p>3. If still more than one fits, the voucher shows an inline picker and blocks Save until you choose.</p>
          <p>4. Unregistered / composition parties suppress GST templates entirely.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Templates {rows.length > 0 && <span className="text-muted-foreground font-normal">({rows.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!activeCompanyId ? (
            <p className="text-sm text-muted-foreground">Select a company to manage templates.</p>
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>No templates yet. Voucher forms will behave exactly as before.</p>
              <p>Create one to enable auto-tax on invoices (e.g. "GST 18% Intra", "GST 18% Inter", "GST 5% Intra").</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">GST %</TableHead>
                  <TableHead className="text-right">Cess %</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>HSN prefix</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => openEdit(t)}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.gst_rate}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.cess_rate}</TableCell>
                    <TableCell>{t.is_interstate ? "Interstate (IGST)" : "Intrastate (CGST+SGST)"}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{t.hsn_prefix || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[
                        t.itc_eligible ? "ITC" : "No ITC",
                        t.is_reverse_charge ? "RCM" : null,
                      ].filter(Boolean).join(" · ")}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => remove(t)}>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit tax template" : "New tax template"}</DialogTitle>
            <DialogDescription>
              Stored locally on this device only. Never uploaded to any server.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: toTitleCaseOnType(e.target.value) }))}
                placeholder="e.g. GST 18% Intra"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>GST rate (%)</Label>
                <Input
                  type="number" min={0} max={100} step="0.01"
                  value={draft.gst_rate}
                  onChange={(e) => setDraft((d) => ({ ...d, gst_rate: Number(e.target.value) }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cess rate (%)</Label>
                <Input
                  type="number" min={0} max={100} step="0.01"
                  value={draft.cess_rate}
                  onChange={(e) => setDraft((d) => ({ ...d, cess_rate: Number(e.target.value) }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>HSN prefix (optional)</Label>
              <Input
                value={draft.hsn_prefix ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, hsn_prefix: e.target.value }))}
                placeholder="e.g. 8471 to match all HSN codes starting with 8471"
              />
              <p className="text-xs text-muted-foreground">
                When set, this template wins over a plain rate match for items whose HSN starts with this prefix.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Interstate (IGST)</Label>
                <p className="text-xs text-muted-foreground">Off = CGST+SGST (intra-state).</p>
              </div>
              <Switch
                checked={draft.is_interstate}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, is_interstate: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">ITC eligible</Label>
                <p className="text-xs text-muted-foreground">Input tax credit can be claimed.</p>
              </div>
              <Switch
                checked={draft.itc_eligible}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, itc_eligible: v }))}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label className="text-sm">Reverse charge (RCM)</Label>
                <p className="text-xs text-muted-foreground">Tax paid by recipient, not supplier.</p>
              </div>
              <Switch
                checked={draft.is_reverse_charge}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, is_reverse_charge: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
