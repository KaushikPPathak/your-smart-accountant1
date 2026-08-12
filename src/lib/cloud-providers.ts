// User-owned cloud backup providers — Google Drive / OneDrive / Dropbox.
//
// Everything here runs entirely in the browser using OAuth 2.0 PKCE
// against public clients. Tokens are stored ONLY in localStorage on the
// user's device — never on our servers. Each user connects their OWN
// account; backups land in a folder in THEIR drive.
//
// Client IDs are read from import.meta.env.VITE_*_CLIENT_ID. When unset,
// the UI shows a "not configured" state instead of a broken button.

export type ProviderId = "gdrive" | "onedrive" | "dropbox";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  scope: string;
  authUrl: string;
  tokenUrl: string;
  extraAuthParams?: Record<string, string>;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gdrive: {
    id: "gdrive",
    label: "Google Drive",
    // drive.file = only files this app creates. Least-privilege.
    scope: "https://www.googleapis.com/auth/drive.file",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  onedrive: {
    id: "onedrive",
    label: "OneDrive",
    // App folder = /Apps/<AppName>/, sandboxed to this app only.
    scope: "Files.ReadWrite.AppFolder offline_access",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  },
  dropbox: {
    id: "dropbox",
    label: "Dropbox",
    // App-folder-scoped Dropbox app; token_access_type=offline gives refresh_token
    scope: "files.content.write files.content.read",
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    extraAuthParams: { token_access_type: "offline" },
  },
};

export function getClientId(id: ProviderId): string | null {
  const env = import.meta.env as Record<string, string | undefined>;
  const key =
    id === "gdrive" ? "VITE_GDRIVE_CLIENT_ID"
    : id === "onedrive" ? "VITE_ONEDRIVE_CLIENT_ID"
    : "VITE_DROPBOX_CLIENT_ID";
  const v = env[key];
  return v && v.length > 0 ? v : null;
}

export function getRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/oauth-callback`;
}

// ---------- Token storage ----------
interface StoredToken {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // ms epoch
  scope?: string;
  account_label?: string;
}
const TOKEN_KEY = (id: ProviderId) => `ym_cloud_token:${id}`;

export function loadToken(id: ProviderId): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY(id));
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch { return null; }
}
export function saveToken(id: ProviderId, tok: StoredToken): void {
  try { localStorage.setItem(TOKEN_KEY(id), JSON.stringify(tok)); } catch { /* ignore */ }
}
export function clearToken(id: ProviderId): void {
  try { localStorage.removeItem(TOKEN_KEY(id)); } catch { /* ignore */ }
}
export function isConnected(id: ProviderId): boolean {
  return loadToken(id) !== null;
}

// ---------- PKCE ----------
function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(n = 64): string {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr.buffer);
}
async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64UrlEncode(hash);
}

// ---------- Popup OAuth ----------
interface CallbackMessage {
  __ym_oauth: true;
  provider: ProviderId;
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

function openPopup(url: string): Window | null {
  const w = 520, h = 640;
  const y = window.top ? Math.max(0, (window.top.outerHeight - h) / 2) : 100;
  const x = window.top ? Math.max(0, (window.top.outerWidth - w) / 2) : 100;
  return window.open(
    url, "ym_oauth",
    `popup=1,width=${w},height=${h},left=${x},top=${y}`,
  );
}

async function runAuthCodeFlow(id: ProviderId): Promise<{ code: string; verifier: string }> {
  const clientId = getClientId(id);
  if (!clientId) throw new Error(`${PROVIDERS[id].label} is not configured (missing client ID).`);
  const provider = PROVIDERS[id];

  const verifier = randomString(64);
  const challenge = await sha256(verifier);
  const state = randomString(24);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: getRedirectUri(),
    scope: provider.scope,
    state: `${id}:${state}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(provider.extraAuthParams ?? {}),
  });
  const authUrl = `${provider.authUrl}?${params.toString()}`;

  const popup = openPopup(authUrl);
  if (!popup) throw new Error("Popup blocked — please allow popups and try again.");

  return new Promise<{ code: string; verifier: string }>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("message", onMsg);
      clearInterval(pollId);
    };
    const onMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const msg = ev.data as CallbackMessage | undefined;
      if (!msg || !msg.__ym_oauth || msg.provider !== id) return;
      if (msg.state !== `${id}:${state}`) {
        cleanup();
        reject(new Error("OAuth state mismatch — aborted for safety."));
        return;
      }
      if (msg.error || !msg.code) {
        cleanup();
        reject(new Error(msg.error_description || msg.error || "OAuth cancelled."));
        return;
      }
      cleanup();
      try { popup.close(); } catch { /* ignore */ }
      resolve({ code: msg.code, verifier });
    };
    window.addEventListener("message", onMsg);
    const pollId = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("OAuth window closed before completion."));
      }
    }, 500);
  });
}

async function exchangeCodeForToken(id: ProviderId, code: string, verifier: string): Promise<StoredToken> {
  const clientId = getClientId(id)!;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetch(PROVIDERS[id].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const j = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  const expires_at = Date.now() + Math.max(60, (j.expires_in ?? 3600) - 30) * 1000;
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at, scope: j.scope };
}

async function refreshAccessToken(id: ProviderId): Promise<StoredToken> {
  const cur = loadToken(id);
  if (!cur?.refresh_token) throw new Error(`Not connected to ${PROVIDERS[id].label}.`);
  const clientId = getClientId(id)!;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: cur.refresh_token,
    client_id: clientId,
  });
  const res = await fetch(PROVIDERS[id].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    clearToken(id);
    throw new Error(`Session with ${PROVIDERS[id].label} expired — please reconnect.`);
  }
  const j = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
  const next: StoredToken = {
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? cur.refresh_token,
    expires_at: Date.now() + Math.max(60, (j.expires_in ?? 3600) - 30) * 1000,
    scope: j.scope ?? cur.scope,
    account_label: cur.account_label,
  };
  saveToken(id, next);
  return next;
}

async function getFreshAccessToken(id: ProviderId): Promise<string> {
  const cur = loadToken(id);
  if (!cur) throw new Error(`Not connected to ${PROVIDERS[id].label}.`);
  if (cur.expires_at > Date.now() + 5000) return cur.access_token;
  const next = await refreshAccessToken(id);
  return next.access_token;
}

// ---------- Public API ----------
export async function connectProvider(id: ProviderId): Promise<void> {
  const { code, verifier } = await runAuthCodeFlow(id);
  const tok = await exchangeCodeForToken(id, code, verifier);
  // Fetch a friendly account label so the UI can show "Connected as user@x".
  tok.account_label = await fetchAccountLabel(id, tok.access_token).catch(() => undefined);
  saveToken(id, tok);
}

export function disconnectProvider(id: ProviderId): void {
  clearToken(id);
}

async function fetchAccountLabel(id: ProviderId, accessToken: string): Promise<string | undefined> {
  try {
    if (id === "gdrive") {
      const r = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json() as { user?: { emailAddress?: string; displayName?: string } };
      return j.user?.emailAddress || j.user?.displayName;
    }
    if (id === "onedrive") {
      const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,displayName", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json() as { userPrincipalName?: string; displayName?: string };
      return j.userPrincipalName || j.displayName;
    }
    if (id === "dropbox") {
      const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const j = await r.json() as { email?: string; name?: { display_name?: string } };
      return j.email || j.name?.display_name;
    }
  } catch { /* ignore */ }
  return undefined;
}

export interface UploadResult {
  provider: ProviderId;
  fileName: string;
  path: string;
  webUrl?: string;
}

const APP_FOLDER = "YourMehtaji";

export async function uploadBackup(
  id: ProviderId,
  fileName: string,
  contents: string,
): Promise<UploadResult> {
  const token = await getFreshAccessToken(id);
  const blob = new Blob([contents], { type: "application/octet-stream" });

  if (id === "gdrive") {
    // Simple multipart upload. drive.file scope only exposes files this app created.
    const metadata = { name: fileName, mimeType: "application/octet-stream" };
    const boundary = "-------YMBoundary" + Math.random().toString(36).slice(2);
    const delim = `\r\n--${boundary}\r\n`;
    const close = `\r\n--${boundary}--`;
    const body =
      delim +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delim +
      "Content-Type: application/octet-stream\r\n\r\n" +
      contents +
      close;
    const r = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!r.ok) throw new Error(`Google Drive upload failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { id: string; name: string; webViewLink?: string };
    return { provider: id, fileName: j.name, path: `Drive / ${j.name}`, webUrl: j.webViewLink };
  }

  if (id === "onedrive") {
    // App-folder upload; small file simple PUT (<4MB is fine for our JSON backups).
    const path = `${APP_FOLDER}/${fileName}`;
    const url = `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(path)}:/content`;
    const r = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: blob,
    });
    if (!r.ok) throw new Error(`OneDrive upload failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { name: string; webUrl?: string };
    return { provider: id, fileName: j.name, path: `Apps / ${APP_FOLDER} / ${j.name}`, webUrl: j.webUrl };
  }

  if (id === "dropbox") {
    // App-folder-scoped Dropbox app uploads relative to the app folder root.
    const arg = { path: `/${fileName}`, mode: "add", autorename: true, mute: true };
    const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify(arg),
      },
      body: blob,
    });
    if (!r.ok) throw new Error(`Dropbox upload failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as { name: string; path_display?: string };
    return { provider: id, fileName: j.name, path: j.path_display || `/${j.name}` };
  }

  throw new Error(`Unknown provider: ${id}`);
}
