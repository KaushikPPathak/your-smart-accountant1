// Android only: pair this phone with the PC. Scan the QR code shown on the PC,
// type the 8-digit PIN, and the company key is stored in the phone's secure
// storage. Shows nothing on other platforms.

import { useState } from "react";
import { toast } from "sonner";
import { Smartphone, ScanLine, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isAndroidRuntime } from "@/lib/native-bridge";
import { acceptPairingOffer } from "@/lib/sync/pairing";
import { phoneKeyStore } from "@/lib/sync/phone-key-store";

const PAIRED_KEY = "ym_sync_paired_companies";

function rememberPaired(companyId: string): void {
  try {
    const list = JSON.parse(localStorage.getItem(PAIRED_KEY) ?? "[]") as string[];
    if (!list.includes(companyId)) list.push(companyId);
    localStorage.setItem(PAIRED_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function pairedCompanyIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PAIRED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

type Step = "idle" | "scanned";

export function PhonePairingCard() {
  const [step, setStep] = useState<Step>("idle");
  const [qrText, setQrText] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState<string[]>(pairedCompanyIds());

  if (!isAndroidRuntime()) return null;

  const scan = async () => {
    setBusy(true);
    try {
      const { checkPermissions, requestPermissions, scan: scanCode, Format } = await import(
        "@tauri-apps/plugin-barcode-scanner"
      );
      if ((await checkPermissions()) !== "granted") {
        if ((await requestPermissions()) !== "granted") {
          toast.error("Camera permission is needed to scan the code");
          return;
        }
      }
      const result = await scanCode({ formats: [Format.QRCode], windowed: false });
      setQrText(result.content);
      setStep("scanned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Scanning failed");
    } finally {
      setBusy(false);
    }
  };

  const pair = async () => {
    if (!qrText) return;
    setBusy(true);
    try {
      const { companyId, companyKey } = await acceptPairingOffer({ qrText, pin });
      await (await phoneKeyStore()).set(companyId, companyKey);
      rememberPaired(companyId);
      setPaired(pairedCompanyIds());
      setStep("idle");
      setQrText(null);
      setPin("");
      toast.success("This phone is paired. Connect OneDrive to start syncing.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pairing failed");
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setStep("idle");
    setQrText(null);
    setPin("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="h-5 w-5" /> Pair this phone with your PC
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>On the PC, open Settings → Sync with OneDrive and choose "Pair a phone". Then scan the code here.</p>
        {paired.length > 0 && (
          <p className="text-muted-foreground">Paired companies: {paired.length}</p>
        )}
        {step === "idle" ? (
          <Button onClick={scan} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
            Scan code from PC
          </Button>
        ) : (
          <div className="space-y-2">
            <p>Type the 8-digit PIN shown on the PC.</p>
            <Input
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="12345678"
              className="max-w-xs tracking-widest"
            />
            <div className="flex gap-2">
              <Button onClick={pair} disabled={busy || pin.length !== 8}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Pair
              </Button>
              <Button variant="outline" onClick={cancel} disabled={busy}>Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
