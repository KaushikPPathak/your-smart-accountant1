import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Building2, Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";

export const Route = createFileRoute("/app/companies")({
  head: () => ({ meta: [{ title: "Companies — Your Mehtaji" }] }),
  component: CompaniesPage,
});

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  gstin: z
    .string()
    .trim()
    .max(15)
    .regex(/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN")
    .optional()
    .or(z.literal("")),
  state: z.string().trim().max(50).optional().or(z.literal("")),
  state_code: z.string().trim().max(3).optional().or(z.literal("")),
});

function CompaniesPage() {
  const { user } = useAuth();
  const { memberships, activeCompanyId, setActiveCompanyId, refresh } = useCompany();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ name: "", gstin: "", state: "", state_code: "" });

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setSubmitting(true);

    // Always read the freshest session to avoid stale auth state during signup → first action
    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData.session?.user?.id ?? user?.id;
    if (!currentUserId) {
      setSubmitting(false);
      toast.error("Your session has expired. Please sign in again.");
      return;
    }

    const { data, error } = await supabase
      .from("companies")
      .insert({
        name: parsed.data.name,
        gstin: parsed.data.gstin || null,
        state: parsed.data.state || null,
        state_code: parsed.data.state_code || null,
        created_by: currentUserId,
      })
      .select("id")
      .maybeSingle();
    setSubmitting(false);
    if (error || !data) {
      console.error("Create company failed:", error);
      toast.error(error?.message ?? "Failed to create company");
      return;
    }
    toast.success("Company created");
    await refresh();
    setActiveCompanyId(data.id);
    setForm({ name: "", gstin: "", state: "", state_code: "" });
    setOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground">
            Each company has its own books. Switch companies from the top bar.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New company
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a new company</DialogTitle>
            </DialogHeader>
            <form onSubmit={onCreate} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Company name *</Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Acme Traders Pvt Ltd"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="gstin">GSTIN</Label>
                  <Input
                    id="gstin"
                    value={form.gstin}
                    onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })}
                    placeholder="22AAAAA0000A1Z5"
                    maxLength={15}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="state_code">State code</Label>
                  <Input
                    id="state_code"
                    value={form.state_code}
                    onChange={(e) => setForm({ ...form, state_code: e.target.value })}
                    placeholder="27"
                    maxLength={3}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  placeholder="Maharashtra"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating…" : "Create company"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {memberships.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No companies yet. Create your first one.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memberships.map((m) => {
            const isActive = m.company_id === activeCompanyId;
            return (
              <Card
                key={m.company_id}
                className={isActive ? "border-primary ring-1 ring-primary/30" : ""}
              >
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">{m.companies.name}</CardTitle>
                    <Badge variant="secondary" className="mt-1 text-[10px] uppercase">
                      {m.role}
                    </Badge>
                  </div>
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>GSTIN</span>
                    <span className="font-mono">{m.companies.gstin ?? "—"}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>State</span>
                    <span>
                      {m.companies.state ?? "—"}
                      {m.companies.state_code ? ` (${m.companies.state_code})` : ""}
                    </span>
                  </div>
                  <div className="pt-2">
                    {isActive ? (
                      <Button variant="secondary" size="sm" className="w-full" disabled>
                        <Check className="mr-2 h-4 w-4" /> Active
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => setActiveCompanyId(m.company_id)}
                      >
                        Switch to this company
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
