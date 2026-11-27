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

/**
 * The desktop plugin adds an Origin header naming the app's webview. Microsoft
 * refuses token requests that carry one (AADSTS90023). An empty Origin header
 * is removed by the plugin, so the request goes out without it.
 */
export function withoutOriginHeader(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Origin", "");
  return { ...init, headers };
}

export async function appFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (inTauri()) {
    const nativeFetch = (await import("@tauri-apps/plugin-http")).fetch as unknown as FetchFn;
    return nativeFetch(input, withoutOriginHeader(init));
  }
  return (fetch as unknown as FetchFn)(input, init);
}
