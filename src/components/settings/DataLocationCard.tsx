// Data Location card for Settings — shows the user that their business
// data lives on this device only, and (soon) lets them configure their
// own cloud backup destination.

import { useEffect, useState } from "react";
import { HardDrive, ShieldCheck, CloudOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { isLocalOnlyMode, subscribeLocalOnlyMode } from "@/lib/local-only-mode";

export function DataLocationCard() {
  const [enabled, setEnabled] = useState<boolean>(() => isLocalOnlyMode());

  useEffect(() => subscribeLocalOnlyMode(setEnabled), []);

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
      <CardContent className="space-y-3 text-sm">
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
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong>Backups are your responsibility.</strong> Use the Backup &
          Restore section below to export a copy — save it to a USB drive, or
          upload it to your own Google Drive / OneDrive / Dropbox. We&apos;re
          adding one-click backup to your own cloud account shortly.
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong>Version updates are safe.</strong> The WebView data folder is
          pinned to a fixed path (<code>%LOCALAPPDATA%\com.smartaccountant.app\EBWebView\</code>)
          and the installer is configured to leave <code>%LOCALAPPDATA%\com.smartaccountant.app\</code>
          untouched on upgrade and uninstall. On every launch we also verify the
          local database is intact and warn you if it looks unexpectedly empty
          after an update.
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <strong>Your data stays forever.</strong> Snapshots and backups on
          this device are kept permanently — no day count, no auto-purge, no
          hidden rotation. The app never deletes accounting data on its own.
          Only you can remove a file, by deleting it from disk yourself.
        </div>

      </CardContent>
    </Card>
  );
}
