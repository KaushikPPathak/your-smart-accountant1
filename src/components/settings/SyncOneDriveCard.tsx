// Connect OneDrive for encrypted sync. The token is kept encrypted on this
// device (see onedrive-token-vault.ts). Only ciphertext goes to OneDrive.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, LogOut, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  connectOneDrive,
  disconnectOneDrive,
  isOneDriveSignedIn,
} from "@/lib/sync/onedrive-session";
import { defaultKeychainKeyStore } from "@/lib/sync/keychain-store";

export function SyncOneDriveCard() {
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConnected(isOneDriveSignedIn());
  }, []);

  const onConnect = async () => {
    setBusy(true);
    try {
      const store = await defaultKeychainKeyStore();
      await connectOneDrive(store);
      setConnected(isOneDriveSignedIn());
      toast.success("OneDrive connected for sync");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect OneDrive");
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = () => {
    disconnectOneDrive();
    setConnected(false);
    toast.success("OneDrive disconnected");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" /> Sync with OneDrive
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Your books stay on this computer. Sync sends only encrypted files to your own OneDrive
          folder, which the app alone can read.
        </p>
        {connected ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Connected</span>
            <Button variant="outline" size="sm" onClick={onDisconnect}>
              <LogOut className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </div>
        ) : (
          <Button onClick={onConnect} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Connect OneDrive
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
