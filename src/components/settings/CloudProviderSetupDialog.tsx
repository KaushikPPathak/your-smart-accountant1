// Per-provider OAuth client configuration.
//
// The app ships with no cloud OAuth client IDs (they are per-deployment
// values). Rather than leaving the provider buttons permanently disabled,
// this dialog lets the user register their OWN OAuth app with the provider
// and paste the resulting Client ID. It is stored in localStorage on this
// device only — exactly like the tokens.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PROVIDERS,
  PROVIDER_SETUP,
  getStoredClientId,
  getEnvClientId,
  setStoredClientId,
  clearStoredClientId,
  getRedirectUri,
  type ProviderId,
} from "@/lib/cloud-providers";

export function CloudProviderSetupDialog({
  provider,
  open,
  onOpenChange,
  onSaved,
}: {
  provider: ProviderId | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open && provider) setValue(getStoredClientId(provider) ?? "");
  }, [open, provider]);

  if (!provider) return null;

  const info = PROVIDERS[provider];
  const setup = PROVIDER_SETUP[provider];
  const redirectUri = getRedirectUri();
  const fromEnv = getEnvClientId(provider);

  const copyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      toast.success("Redirect URI copied");
    } catch {
      toast.error("Could not copy — select the text manually");
    }
  };

  const save = () => {
    const v = value.trim();
    if (!v) {
      toast.error("Paste the Client ID / App key first");
      return;
    }
    setStoredClientId(provider, v);
    onSaved();
    onOpenChange(false);
    toast.success(`${info.label} configured — you can connect now`);
  };

  const clear = () => {
    clearStoredClientId(provider);
    setValue("");
    onSaved();
    toast.success(`${info.label} configuration cleared`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>'''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''</DialogTitle>
          <DialogDescription>
            apply it for one drive and drop box make signing simple
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <div className="font-medium">App type: {setup.appType}</div>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              {setup.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <a
              href={setup.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open {info.label} developer console <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          <div className="space-y-1">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Redirect URI to register
            </Label>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border bg-muted/40 px-2 py-1 text-xs">
                {redirectUri || "/oauth-callback"}
              </code>
              <Button size="sm" variant="outline" onClick={copyRedirect}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              This exact string must be listed as an allowed redirect URI, otherwise
              sign-in will fail with a redirect_uri_mismatch error.
            </p>
            {!/^https?:\/\//.test(redirectUri) && (
              <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                This desktop build serves the app from <code>{redirectUri}</code>, which
                the provider will not accept as a redirect URI. Use one-click cloud
                backup from the web/preview build, or run the desktop app behind an
                http(s) origin.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="cloud-client-id">
              {provider === "dropbox" ? "App key" : "Client ID"}
            </Label>
            <Input
              id="cloud-client-id"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                provider === "gdrive"
                  ? "xxxxxxxx.apps.googleusercontent.com"
                  : provider === "onedrive"
                  ? "00000000-0000-0000-0000-000000000000"
                  : "your dropbox app key"
              }
              autoComplete="off"
              spellCheck={false}
            />
            {fromEnv && !getStoredClientId(provider) && (
              <p className="text-[11px] text-muted-foreground">
                A build-time value from {setup.envVar} is already in use. Saving here
                overrides it on this device.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              Deployments can instead bake this in as <code>{setup.envVar}</code>.
              Never paste a client <em>secret</em> — it is not needed (PKCE flow).
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={clear} disabled={!getStoredClientId(provider)}>
            Clear
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
