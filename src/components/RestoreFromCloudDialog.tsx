// Pull a specific cloud company's full snapshot into the local cache
// WITHOUT creating a new company. Useful when re-installing the app or
// migrating data to a new machine.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, CloudDownload, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { pullCompanySnapshot } from "@/lib/offline/snapshot";

interface CloudCompany {
  company_id: string;
  name: string;
  has_password: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
}

export function RestoreFromCloudDialog({ open, onOpenChange, onComplete }: Props) {
  const [loading, setLoading] = useState(false);
  const [companies, setCompanies] = useState<CloudCompany[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          toast.error("Not signed in to cloud");
          setCompanies([]);
          return;
        }
        const { data, error } = await supabase
          .from("company_members")
          .select("company_id, companies(name, access_password_hash)")
          .eq("user_id", user.id);
        if (error) throw error;
        const list: CloudCompany[] = (data ?? []).map((r) => {
          const c = r as unknown as { company_id: string; companies: { name: string; access_password_hash: string | null } | null };
          return {
            company_id: c.company_id,
            name: c.companies?.name ?? "(unnamed)",
            has_password: Boolean(c.companies?.access_password_hash),
          };
        });
        setCompanies(list);
      } catch (e) {
        toast.error((e as { message?: string })?.message ?? "Could not list cloud companies");
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  const handlePull = async (c: CloudCompany) => {
    setPulling(c.company_id);
    setProgress("Connecting…");
    try {
      setProgress("Pulling ledgers, items, vouchers…");
      const result = await pullCompanySnapshot(c.company_id, { full: true });
      if (!result) {
        toast.error("Offline — connect to the internet to restore.");
        return;
      }
      const totalRows = Object.values(result.pulled).reduce((a, b) => a + b, 0);
      const errCount = Object.keys(result.errors).length;
      if (errCount > 0) {
        toast.warning(`Restored ${totalRows} rows. ${errCount} table(s) failed — see Offline status.`);
      } else {
        toast.success(`Restored ${totalRows} rows from cloud for ${c.name}`);
      }
      onComplete?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Restore failed");
    } finally {
      setPulling(null);
      setProgress("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-5 w-5 text-primary" />
            Restore from cloud
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Pulls every ledger, item, voucher and setting from one of your cloud
          companies into this device's local cache. No new company is created.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : companies.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No cloud companies linked to this account.
          </p>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {companies.map((c) => (
              <div key={c.company_id} className="flex items-center justify-between rounded-md border bg-card p-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{c.name}</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => handlePull(c)}
                  disabled={pulling !== null}
                >
                  {pulling === c.company_id ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Pulling…</>
                  ) : (
                    <><CloudDownload className="mr-1.5 h-3.5 w-3.5" /> Pull</>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        {progress && (
          <p className="text-xs text-muted-foreground italic">{progress}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
