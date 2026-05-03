import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ACCOUNT_GROUPS, GROUP_BY_CODE, type AccountSection } from "@/lib/account-groups";
import { useAccountGroups, resolveGroupLabel, subgroupsFor, type Subgroup } from "@/lib/account-groups-runtime";
import { useCompany } from "@/lib/company-context";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/app/account-groups")({
  head: () => ({ meta: [{ title: "Group Manager — Your Mehtaji" }] }),
  component: GroupManagerPage,
});

const SECTION_LABEL: Record<AccountSection, string> = {
  BS_LIAB: "Sources of Funds (Liabilities)",
  BS_ASSET: "Application of Funds (Assets)",
  TRADING: "Trading Account",
  PL: "Profit & Loss Account",
};

function GroupManagerPage() {
  const { activeCompanyId, activeMembership } = useCompany();
  const { subgroups, overrides, reload } = useAccountGroups();
  const canWrite = activeMembership?.role === "admin" || activeMembership?.role === "accountant";

  const [renameOpen, setRenameOpen] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [subOpen, setSubOpen] = useState<{ parent: string; edit?: Subgroup } | null>(null);
  const [subName, setSubName] = useState("");

  const openRename = (code: string) => {
    setRenameValue(overrides[code] ?? GROUP_BY_CODE[code]?.label ?? "");
    setRenameOpen(code);
  };

  const saveRename = async () => {
    if (!activeCompanyId || !renameOpen) return;
    const builtin = GROUP_BY_CODE[renameOpen]?.label;
    const label = renameValue.trim();
    if (!label) { toast.error("Label is required"); return; }
    if (label === builtin) {
      // remove override
      await supabase.from("account_group_overrides").delete()
        .eq("company_id", activeCompanyId).eq("group_code", renameOpen);
    } else {
      const { error } = await supabase.from("account_group_overrides")
        .upsert({ company_id: activeCompanyId, group_code: renameOpen, label }, { onConflict: "company_id,group_code" });
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Label updated");
    setRenameOpen(null);
    reload();
  };

  const resetLabel = async (code: string) => {
    if (!activeCompanyId) return;
    await supabase.from("account_group_overrides").delete()
      .eq("company_id", activeCompanyId).eq("group_code", code);
    toast.success("Reset to default");
    reload();
  };

  const openNewSub = (parent: string) => { setSubName(""); setSubOpen({ parent }); };
  const openEditSub = (parent: string, sg: Subgroup) => { setSubName(sg.name); setSubOpen({ parent, edit: sg }); };

  const saveSub = async () => {
    if (!activeCompanyId || !subOpen) return;
    const name = subName.trim();
    if (!name) { toast.error("Name required"); return; }
    if (subOpen.edit) {
      const { error } = await supabase.from("account_subgroups")
        .update({ name }).eq("id", subOpen.edit.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("account_subgroups").insert({
        company_id: activeCompanyId, parent_group_code: subOpen.parent, name,
      });
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Saved");
    setSubOpen(null);
    reload();
  };

  const deleteSub = async (sg: Subgroup) => {
    if (!confirm(`Delete sub-group "${sg.name}"? Ledgers tagged to it will revert to the parent group.`)) return;
    const { error } = await supabase.from("account_subgroups").delete().eq("id", sg.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    reload();
  };

  const sections: AccountSection[] = ["BS_LIAB", "BS_ASSET", "TRADING", "PL"];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Group Manager</h1>
        <p className="text-sm text-muted-foreground">
          Rename built-in heads (e.g. "Sundry Debtors" → "Trade Receivables") or add custom sub-groups
          (e.g. "Investments → Mutual Funds"). Changes apply only to this company.
        </p>
      </div>

      {sections.map((sec) => (
        <Card key={sec}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
              {SECTION_LABEL[sec]}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {ACCOUNT_GROUPS.filter((g) => g.section === sec)
              .sort((a, b) => a.order - b.order)
              .map((g) => {
                const subs = subgroupsFor(g.code, subgroups);
                const isRenamed = overrides[g.code] !== undefined;
                return (
                  <div key={g.code} className="rounded border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">
                          {resolveGroupLabel(g.code, overrides)}
                          {isRenamed && (
                            <Badge variant="secondary" className="ml-2 text-[10px]">renamed</Badge>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">{g.code}</div>
                      </div>
                      {canWrite && (
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openRename(g.code)} title="Rename label">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isRenamed && (
                            <Button variant="ghost" size="icon" onClick={() => resetLabel(g.code)} title="Reset to default">
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      {subs.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">No sub-groups yet.</p>
                      ) : (
                        subs.map((s) => (
                          <div key={s.id} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs">
                            <span>↳ {s.name}</span>
                            {canWrite && (
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditSub(g.code, s)}>
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteSub(s)}>
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                      {canWrite && (
                        <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => openNewSub(g.code)}>
                          <Plus className="mr-1 h-3 w-3" /> Add sub-group
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      ))}

      <Dialog open={renameOpen !== null} onOpenChange={(o) => !o && setRenameOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Group</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
            <p className="text-[11px] text-muted-foreground">
              Default: <code className="font-mono">{renameOpen ? GROUP_BY_CODE[renameOpen]?.label : ""}</code>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameOpen(null)}>Cancel</Button>
            <Button onClick={saveRename}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={subOpen !== null} onOpenChange={(o) => !o && setSubOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{subOpen?.edit ? "Edit Sub-Group" : "Add Sub-Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={subName} onChange={(e) => setSubName(e.target.value)} autoFocus placeholder="e.g. Mutual Funds" />
            <p className="text-[11px] text-muted-foreground">
              Under: <strong>{subOpen ? resolveGroupLabel(subOpen.parent, overrides) : ""}</strong>
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSubOpen(null)}>Cancel</Button>
            <Button onClick={saveSub}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}