// Sync settings: connect OneDrive, turn sync on for the open company, and pair
// a phone. Books stay on this PC; only encrypted files go to the user's folder.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Cloud, LogOut, Loader2, Smartphone, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/lib/company-context";
import {
  connectOneDrive,
  disconnectOneDrive,
  ensureOneDriveClientId,
  isOneDriveSignedIn,
} from "@/lib/sync/onedrive-session";
import { defaultKeychainKeyStore } from "@/lib/sync/keychain-store";
import {
  isSyncOn,
  oneDriveSyncFolder,
  setSyncOn,
  startPhonePairing,
  syncNowPc,
  turnOnSync,
} from "@/lib/sync/sync-setup";
import { PAIRING_TTL_MS, type PairingOffer } from "@/lib/sync/pairing";

type Pairing = PairingOffer & { qr: string };

export function SyncOneDriveCard() {
  const { activeCompanyId } = useCompany();
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [syncOn, setSyncOnState] = useState(false);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setConnected(isOneDriveSignedIn());
  }, []);

  // Sync on/off is remembered per company, so it survives a restart.
  useEffect(() => {
    setSyncOnState(activeCompanyId ? isSyncOn(activeCompanyId) : false);
  }, [activeCompanyId]);

  // Count down the pairing offer.
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairing]);

  const expired = pairing ? now > pairing.expiresAt : false;
  const secondsLeft = pairing ? Math.max(0, Math.ceil((pairing.expiresAt - now) / 1000)) : 0;

  const onConnect = async () => {
    setBusy("connect");
    try {
      const store = await defaultKeychainKeyStore();
      await connectOneDrive(store);
      setConnected(isOneDriveSignedIn());
      toast.success("OneDrive connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect OneDrive");
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = () => {
    disconnectOneDrive();
    setConnected(false);
    if (activeCompanyId) setSyncOn(activeCompanyId, false);
    setSyncOnState(false);
    setPairing(null);
    toast.success("OneDrive disconnected");
  };

  const onTurnOn = async () => {
    if (!activeCompanyId) return;
    setBusy("on");
    try {
      ensureOneDriveClientId();
      const store = await defaultKeychainKeyStore();
      const res = await turnOnSync(oneDriveSyncFolder(store), store, activeCompanyId);
      setSyncOn(activeCompanyId, true);
      setSyncOnState(true);
      toast.success(res.recoveryCreated ? "Sync is on. Recovery copy saved to OneDrive." : "Sync is on.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not turn on sync");
    } finally {
      setBusy(null);
    }
  };

  const onSyncNow = async () => {
    if (!activeCompanyId) return;
    setBusy("now");
    try {
      const store = await defaultKeychainKeyStore();
      const res = await syncNowPc(store, activeCompanyId);
      toast.success(
        res.entriesSent === 0
          ? "Nothing new to send."
          : `Sent ${res.entriesSent} change${res.entriesSent === 1 ? "" : "s"} to OneDrive.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const onPair = async () => {
    if (!activeCompanyId) return;
    setBusy("pair");
    try {
      const store = await defaultKeychainKeyStore();
      const offer = await startPhonePairing(store, activeCompanyId);
      const qr = await QRCode.toDataURL(offer.qrText, { width: 220, margin: 1 });
      setNow(Date.now());
      setPairing({ ...offer, qr });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start pairing");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" /> Sync with OneDrive
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p>
          Your books stay on this computer. Sync sends only encrypted files to your own OneDrive
          folder, which the app alone can read.
        </p>

        {!connected ? (
          <Button onClick={onConnect} disabled={busy !== null}>
            {busy === "connect" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Connect OneDrive
          </Button>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">OneDrive connected</span>
            <Button variant="outline" size="sm" onClick={onDisconnect}>
              <LogOut className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </div>
        )}

        {connected && (
          <div className="space-y-2">
            {!syncOn ? (
              <Button onClick={onTurnOn} disabled={busy !== null || !activeCompanyId}>
                {busy === "on" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <ShieldCheck className="mr-2 h-4 w-4" /> Turn on sync for this company
              </Button>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <ShieldCheck className="h-4 w-4" /> Sync is on for this company
                </p>
                <Button size="sm" onClick={onSyncNow} disabled={busy !== null}>
                  {busy === "now" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sync now
                </Button>
              </div>
            )}
          </div>
        )}

        {connected && syncOn && (
          <div className="space-y-3 border-t pt-3">
            {!pairing || expired ? (
              <Button variant="outline" onClick={onPair} disabled={busy !== null}>
                {busy === "pair" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Smartphone className="mr-2 h-4 w-4" />
                {expired ? "Make a new code" : "Pair a phone"}
              </Button>
            ) : (
              <div className="space-y-2">
                <p>Scan this code on the phone, then type the PIN.</p>
                <img src={pairing.qr} alt="Pairing QR code" className="h-56 w-56 rounded border bg-white p-1" />
                <p className="text-2xl font-semibold tracking-widest">
                  {pairing.pin.slice(0, 4)} {pairing.pin.slice(4)}
                </p>
                <p className="text-muted-foreground">
                  Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                  {" "}(valid for {PAIRING_TTL_MS / 60000} minutes)
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
