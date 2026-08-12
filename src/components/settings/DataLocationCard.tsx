// Data Location card for Settings — shows the user that their business
// data lives on this device only, and (soon) lets them configure their
// own cloud backup destination.

import * as React from "react";
import { HardDrive, ShieldCheck, CloudOff, FolderOpen, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isLocalOnlyMode, subscribeLocalOnlyMode } from "@/lib/local-only-mode";
import { getShortDataRoot, setCustomDataRoot } from "@/lib/short-data-root";
import { pickFolderNative, isDesktopRuntime } from "@/lib/native-bridge";
import { toast } from "sonner";

export function DataLocationCard() {
  const [enabled, setEnabled] = React.useState<boolean>(() => isLocalOnlyMode());
  const [dataRoot, setDataRoot] = React.useState<string>("");
  const isDesktop = isDesktopRuntime();

  React.useEffect(() => subscribeLocalOnlyMode(setEnabled), []);

  React.useEffect(() => {
    void getShortDataRoot().then((root) => {
      if (root) setDataRoot(root);
    });
  }, []);

  const handlePickFolder = async () => {
    const res = await pickFolderNative(dataRoot);
    if (res.ok && res.path) {
      setCustomDataRoot(res.path);
      setDataRoot(res.path);
      toast.success("Data root updated", {
        description: `New reports and backups will be saved to: ${res.path}`,
        icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <HardDrive className="h-4 w-4" />
          Data location
          {enabled ? (
            <Badge variant="secondary" className="ml-2 gap-1">
              <ShieldCheck className="h-3 w-3" /> On this device only
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="flex items-start gap-2">
          <CloudOff className="mt-0.5 h-4 w-4 text-muted-foreground shrink-0" />
          <span>
            Every company, voucher, ledger, item and setting you create is
            stored <strong>only on this computer</strong>. Nothing about your
            business is written to our servers. Login/signup still uses the
            cloud so you can sign back in on a fresh install, but your
            accounting data never leaves the device.
          </span>
        </p>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Export & Backup Folder
          </label>
          <div className="flex gap-2">
            <Input 
              value={dataRoot || "Calculating..."} 
              readOnly 
              className="bg-muted font-mono text-xs" 
            />
            {isDesktop && (
              <Button variant="outline" size="sm" onClick={handlePickFolder} className="shrink-0 gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                Change
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground italic">
            Reports, backups, and GST files are saved here. Since your D: drive is currently unavailable, you can switch this to a folder on your C: drive or another working location.
          </p>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong>Backups are your responsibility.</strong> Use the Backup &
          Restore section below to export a copy — save it to a USB drive, or
          upload it to your own Google Drive / OneDrive / Dropbox. We&apos;re
          adding one-click backup to your own cloud account shortly.
        </div>
        
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong>Version updates are safe.</strong> The app&apos;s
          internal database is pinned to a fixed system location and the
          installer leaves your data root untouched on upgrade/uninstall.
        </div>
      </CardContent>
    </Card>
  );
}
