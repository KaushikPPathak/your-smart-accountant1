import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatINR } from "@/lib/money";
import type { EntityFeatureFlags } from "@/lib/entity-status";

interface Member {
  id: string;
  member_role: string;
  full_name: string;
  designation: string | null;
  pan: string | null;
  din: string | null;
  email: string | null;
  phone: string | null;
  share_percent: number;
  profit_sharing_ratio: number;
  capital_contribution_paise: number;
  appointed_on: string | null;
  is_active: boolean;
}

const blank = (role: string): Omit<Member, "id"> => ({
  member_role: role,
  full_name: "",
  designation: null,
  pan: null,
  din: null,
  email: null,
  phone: null,
  share_percent: 0,
  profit_sharing_ratio: 0,
  capital_contribution_paise: 0,
  appointed_on: null,
  is_active: true,
});

export function EntityMembersEditor({
  companyId,
  features,
}: {
  companyId: string;
  features: EntityFeatureFlags;
}) {
  const [rows, setRows] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const role = features.memberRoleLabel ?? "member";
  const tabLabel = features.membersTabLabel ?? "Members";

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("entity_members")
      .select("id, member_role, full_name, designation, pan, din, email, phone, share_percent, profit_sharing_ratio, capital_contribution_paise, appointed_on, is_active")
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRows((data ?? []) as Member[]);
  };

  useEffect(() => { load(); }, [companyId]);

  const addRow = async () => {
    const { data, error } = await supabase
      .from("entity_members")
      .insert({ company_id: companyId, ...blank(role) })
      .select("*")
      .single();
    if (error || !data) { toast.error(error?.message ?? "Failed"); return; }
    setRows((r) => [...r, data as Member]);
  };

  const update = async (id: string, patch: Partial<Member>) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase.from("entity_members").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this entry?")) return;
    const { error } = await supabase.from("entity_members").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setRows((r) => r.filter((x) => x.id !== id));
  };

  const totalShare = rows.reduce((s, r) => s + Number(r.share_percent || 0), 0);
  const totalPSR = rows.reduce((s, r) => s + Number(r.profit_sharing_ratio || 0), 0);
  const totalCapital = rows.reduce((s, r) => s + Number(r.capital_contribution_paise || 0), 0);

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" /> {tabLabel}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addRow}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No {tabLabel.toLowerCase()} yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <div key={m.id} className="grid gap-2 rounded border bg-background p-2 md:grid-cols-12">
              <div className="md:col-span-3">
                <Label className="text-[10px] uppercase">Name</Label>
                <Input value={m.full_name} onChange={(e) => setRows((r) => r.map((x) => x.id === m.id ? { ...x, full_name: toTitleCaseOnType(e.target.value) } : x))}
                  onBlur={(e) => update(m.id, { full_name: toTitleCaseOnType(e.target.value) })} />
              </div>
              <div className="md:col-span-2">
                <Label className="text-[10px] uppercase">PAN</Label>
                <Input value={m.pan ?? ""} maxLength={10}
                  onChange={(e) => setRows((r) => r.map((x) => x.id === m.id ? { ...x, pan: e.target.value.toUpperCase() } : x))}
                  onBlur={(e) => update(m.id, { pan: e.target.value.toUpperCase() || null })} />
              </div>
              {features.showDirectors && (
                <div className="md:col-span-2">
                  <Label className="text-[10px] uppercase">DIN</Label>
                  <Input value={m.din ?? ""} maxLength={8}
                    onChange={(e) => setRows((r) => r.map((x) => x.id === m.id ? { ...x, din: e.target.value } : x))}
                    onBlur={(e) => update(m.id, { din: e.target.value || null })} />
                </div>
              )}
              {features.showDirectors && (
                <div className="md:col-span-2">
                  <Label className="text-[10px] uppercase">Share %</Label>
                  <Input type="number" step="0.01" value={m.share_percent}
                    onChange={(e) => setRows((r) => r.map((x) => x.id === m.id ? { ...x, share_percent: Number(e.target.value) } : x))}
                    onBlur={(e) => update(m.id, { share_percent: Number(e.target.value) })} />
                </div>
              )}
              {features.showPartners && (
                <div className="md:col-span-2">
                  <Label className="text-[10px] uppercase">PSR %</Label>
                  <Input type="number" step="0.01" value={m.profit_sharing_ratio}
                    onChange={(e) => setRows((r) => r.map((x) => x.id === m.id ? { ...x, profit_sharing_ratio: Number(e.target.value) } : x))}
                    onBlur={(e) => update(m.id, { profit_sharing_ratio: Number(e.target.value) })} />
                </div>
              )}
              <div className="md:col-span-2">
                <Label className="text-[10px] uppercase">Capital (₹)</Label>
                <Input type="number" step="0.01"
                  value={m.capital_contribution_paise / 100}
                  onChange={(e) => setRows((r) => r.map((x) => x.id === m.id ? { ...x, capital_contribution_paise: Math.round(Number(e.target.value) * 100) } : x))}
                  onBlur={(e) => update(m.id, { capital_contribution_paise: Math.round(Number(e.target.value) * 100) })} />
              </div>
              <div className="md:col-span-1 flex items-end">
                <Button type="button" size="icon" variant="ghost" onClick={() => remove(m.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap justify-end gap-4 pt-1 text-xs text-muted-foreground">
            {features.showDirectors && <span>Total Share %: <strong className={totalShare > 100 ? "text-destructive" : ""}>{totalShare.toFixed(2)}</strong></span>}
            {features.showPartners && <span>Total PSR %: <strong className={totalPSR > 100 ? "text-destructive" : ""}>{totalPSR.toFixed(2)}</strong></span>}
            <span>Total Capital: <strong>{formatINR(totalCapital)}</strong></span>
          </div>
        </div>
      )}
    </div>
  );
}