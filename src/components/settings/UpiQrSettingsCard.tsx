// Settings card: business UPI ID + merchant name used to build dynamic
// payment QR codes on invoices. Stored on this device only.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { QrCode, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  buildUpiUri,
  emptyUpiSettings,
  loadUpiSettings,
  saveUpiSettings,
  upiQrDataUrl,
  validateUpiSettings,
  type UpiSettings,
} from "@/lib/upi";

export function UpiQrSettingsCard({ companyId }: { companyId: string | null }) {
  const [form, setForm] = useState<UpiSettings>(emptyUpiSettings);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setForm(loadUpiSettings(companyId));
  }, [companyId]);

  const error = validateUpiSettings(form);

  useEffect(() => {
    let alive = true;
    if (error) { setPreview(null); return; }
    const uri = buildUpiUri({ pa: form.pa, pn: form.pn, amountPaise: 100000, note: "Sample" });
    upiQrDataUrl(uri, 160).then((d) => { if (alive) setPreview(d); }).catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [form.pa, form.pn, error]);

  const save = () => {
    if (!companyId) return;
    const err = validateUpiSettings(form);
    if (err) { toast.error(err); return; }
    saveUpiSettings(companyId, { ...form, pa: form.pa.trim(), pn: form.pn.trim() });
    toast.success("UPI details saved on this device");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4 w-4" /> UPI payment QR
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Invoices show a scannable QR with the exact bill amount pre-filled. These details stay on this device.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="upi-pa">Bank UPI ID (VPA)</Label>
            <Input
              id="upi-pa"
              value={form.pa}
              onChange={(e) => setForm({ ...form, pa: e.target.value })}
              placeholder="business@okicici"
              maxLength={128}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="upi-pn">Business / merchant name</Label>
            <Input
              id="upi-pn"
              value={form.pn}
              onChange={(e) => setForm({ ...form, pn: e.target.value })}
              placeholder="Arihant Paper Co"
              maxLength={50}
            />
          </div>
          <div className="flex items-center justify-between rounded border p-3 md:col-span-2">
            <Label htmlFor="upi-print">Print the QR on invoice PDFs</Label>
            <Switch
              id="upi-print"
              checked={form.printOnInvoice}
              onCheckedChange={(v) => setForm({ ...form, printOnInvoice: v })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Button onClick={save} disabled={!companyId || !!error}>
            <Save className="mr-2 h-4 w-4" /> Save UPI details
          </Button>
          {error ? (
            <span className="text-xs text-muted-foreground">{error}</span>
          ) : preview ? (
            <div className="flex items-center gap-3">
              <img src={preview} alt="Sample UPI QR preview" className="h-20 w-20 rounded border bg-background p-0.5" />
              <span className="text-xs text-muted-foreground">Preview (sample ₹1,000.00)</span>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
