// OAuth callback for cloud backup sign-in.
//
// Desktop: the sign-in runs in its own window; this page forwards the code to
// the opener window (or the desktop shell intercepts it before it loads).
// Android: the app itself navigated to the provider, so this page completes
// the sign-in (exchanges the code and saves the token) and returns to Settings.
// Nothing here talks to our servers.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { completeAndroidSignIn } from "@/lib/cloud-providers";

export const Route = createFileRoute("/oauth-callback")({
  component: OAuthCallback,
});

function OAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isPopup = Boolean(window.opener);

    if (!isPopup) {
      // Android (same-window redirect): finish here and go back to Settings.
      let cancelled = false;
      completeAndroidSignIn(params)
        .then(() => { if (!cancelled) navigate({ to: "/app/settings" }); })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
      return () => { cancelled = true; };
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code") ?? undefined;
    const state = url.searchParams.get("state") ?? undefined;
    const err = url.searchParams.get("error") ?? undefined;
    const error_description = url.searchParams.get("error_description") ?? undefined;
    // state is "<provider>:<random>"
    const provider = (state?.split(":")[0] ?? "") as "gdrive" | "onedrive" | "dropbox";

    const msg = { __ym_oauth: true, provider, code, state, error: err, error_description };
    try {
      window.opener.postMessage(msg, window.location.origin);
    } catch { /* ignore */ }
    // Give the opener a tick, then close.
    setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 200);
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-lg font-semibold">Sign-in did not finish</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            className="rounded-md border px-4 py-2 text-sm"
            onClick={() => navigate({ to: "/app/settings" })}
          >
            Back to settings
          </button>
        </div>
      </div>
    );
  }

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
