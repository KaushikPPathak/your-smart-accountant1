// OAuth popup callback — receives ?code=&state= from any of the providers
// (Google/Microsoft/Dropbox), forwards it to the opener window via
// postMessage, then closes itself. Nothing here talks to our servers.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/oauth-callback")({
  component: OAuthCallback,
});

function OAuthCallback() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code") ?? undefined;
    const state = url.searchParams.get("state") ?? undefined;
    const error = url.searchParams.get("error") ?? undefined;
    const error_description = url.searchParams.get("error_description") ?? undefined;
    // state is "<provider>:<random>"
    const provider = (state?.split(":")[0] ?? "") as "gdrive" | "onedrive" | "dropbox";

    const msg = { __ym_oauth: true, provider, code, state, error, error_description };
    try {
      if (window.opener) {
        window.opener.postMessage(msg, window.location.origin);
      }
    } catch { /* ignore */ }
    // Give the opener a tick, then close.
    setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 200);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-sm text-center space-y-2">
        <h1 className="text-lg font-semibold">Finishing sign-in…</h1>
        <p className="text-sm text-muted-foreground">
          You can close this window if it doesn&apos;t close automatically.
        </p>
      </div>
    </div>
  );
}
