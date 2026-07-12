import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { KeyRound, Copy, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { activateLicenseKey, deactivateLicense } from "@/lib/license/state";
import { useLicenseState, notifyLicenseChanged } from "@/lib/license/hook";
import { getMachineIdShort } from "@/lib/license/machine-id";

export const Route = createFileRoute("/app/settings/license")({
  head: () => ({ meta: [{ title: "License — Your Mehtaji" }] }),
  component: LicensePage,
});

function LicensePage() {
  const state = useLicenseState();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const machineId = getMachineIdShort();

  const activate = async () => {
    if (!input.trim()) {
      toast.error("Paste a license key first.");
      return;
    }
    setBusy(true);
    try {
      const res = await activateLicenseKey(input);
      if (!res.ok) {
        const msgs: Record<string, string> = {
          malformed: "That doesn't look like a valid license key.",
          bad_signature: "License key signature failed — key is tampered or from a different vendor.",
          no_public_key: "This build has no public key baked in — contact support.",
          expired: "This license has expired.",
          device_limit_reached: "Maximum devices reached for this key. Contact the seller for a reset or a larger key.",
        };
        toast.error(msgs[res.reason ?? ""] ?? "Activation failed.");
        return;
      }
      toast.success("License activated. Thank you!");
      setInput("");
      notifyLicenseChanged();
    } finally {
      setBusy(false);
    }
  };

  const removeKey = () => {
    deactivateLicense();
    notifyLicenseChanged();
    toast.message("License removed from this device.");
  };

  const copyMachineId = async () => {
    try {
      await navigator.clipboard.writeText(machineId);
      toast.success("Machine ID copied.");
    } catch {
      toast.error("Copy failed — write it down manually.");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-1">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          License
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter a license key to unlock the full app after the trial. Everything is verified on this device — no internet needed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {state.mode === "licensed" ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Licensed
              </>
            ) : state.mode === "trial" ? (
              <>
                <KeyRound className="h-4 w-4 text-amber-600" />
                Trial
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-destructive" />
                Trial ended
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {state.mode === "licensed" ? (
            <>
              <Row label="Licensed to" value={state.customerName ?? "—"} />
              <Row label="Email" value={state.customerEmail ?? "—"} />
              <Row
                label="Plan"
                value={<Badge variant="secondary" className="capitalize">{state.plan}</Badge>}
              />
              <Row
                label="Expires"
                value={
                  state.plan === "lifetime"
                    ? <Badge variant="outline">Never</Badge>
                    : state.expiresAt?.toLocaleDateString() ?? "—"
                }
              />
              <Row label="Devices used" value={`${state.deviceCount} / ${state.maxDevices}`} />
              <Row label="License ID" value={<span className="font-mono text-xs">{state.licenseId}</span>} />
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={removeKey}>
                  Remove license from this device
                </Button>
              </div>
            </>
          ) : state.mode === "trial" ? (
            <p>
              You have <strong>{state.daysLeft}</strong> {state.daysLeft === 1 ? "day" : "days"} of trial remaining. All features are unlocked except cloud backup.
            </p>
          ) : (
            <p className="text-destructive">
              Your 30-day trial has ended. You can still open reports (read-only, watermarked) but voucher creation is locked until you activate a license.
            </p>
          )}
        </CardContent>
      </Card>

      {state.mode !== "licensed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activate a license key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste your license key (starts with SMAC-...)"
              className="font-mono text-xs min-h-24"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button onClick={activate} disabled={busy}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {busy ? "Activating…" : "Activate"}
              </Button>
              <div className="text-xs text-muted-foreground">
                This machine ID:{" "}
                <button
                  type="button"
                  onClick={copyMachineId}
                  className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono hover:bg-muted"
                  title="Share this if the seller asks for it"
                >
                  {machineId}
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <p><strong>Lost your key?</strong> Contact the seller with the email you used at purchase.</p>
          <p><strong>Switching to a new PC?</strong> Ask the seller to re-mint your key with an extra device slot, or to reset your device list.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}
