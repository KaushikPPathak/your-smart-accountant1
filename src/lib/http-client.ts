// HTTP calls for the cloud providers. In the desktop app the request goes
// through the native HTTP plugin, which is not subject to the webview's CORS
// rules; Microsoft's token endpoint refuses browser-origin requests for this
// app type. Browsers use plain fetch. Hosts must be listed in
// src-tauri/capabilities/default.json.

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function inTauri(): boolean {
  const w = typeof window !== "undefined" ? (window as unknown as { __TAURI_INTERNALS__?: unknown }) : undefined;
  return Boolean(w?.__TAURI_INTERNALS__);
}

export async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const doFetch: FetchFn = inTauri()
    ? ((await import("@tauri-apps/plugin-http")).fetch as unknown as FetchFn)
    : (fetch as unknown as FetchFn);
  return doFetch(input, init);
}
