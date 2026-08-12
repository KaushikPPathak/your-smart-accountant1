// Headroom compression layer.
//
// Wraps the `headroom-ai` `compress()` call and the CCR (Content-Compressed
// Retrieval) store so the rest of the app can stay agnostic of whether a
// Headroom proxy is reachable.
//
// - When VITE_HEADROOM_PROXY_URL is set (and the proxy is healthy), raw
//   accounting payloads are compressed before being shipped to the LLM.
// - When the proxy is not reachable, `compressMessages()` returns the
//   original messages unchanged so the app keeps working offline.
// - A small in-memory CCR cache holds the original (uncompressed) row data
//   keyed by hash + row id, so the LLM (or the assistant runtime) can
//   request the exact raw rows back via `retrieveOriginal()`.

import { compress, HeadroomClient, type CompressResult } from "headroom-ai";

type AnyMessage = { role: string; content: unknown; [k: string]: unknown };

const PROXY_URL =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_HEADROOM_PROXY_URL) ||
  "";

let _client: HeadroomClient | null = null;
let _proxyHealthy: boolean | null = null;

export function getHeadroomClient(): HeadroomClient | null {
  if (!PROXY_URL) return null;
  if (!_client) {
    _client = new HeadroomClient({
      baseUrl: PROXY_URL,
      config: {
        smartCrusher: { enabled: true, maxItemsAfterCrush: 25 },
        toolCrusher: { enabled: true, maxArrayItems: 25 },
        ccr: {
          enabled: true,
          storeMaxEntries: 500,
          injectRetrievalMarker: true,
          injectTool: true,
          injectSystemInstructions: true,
        },
      },
    });
  }
  return _client;
}

async function isProxyReachable(): Promise<boolean> {
  if (_proxyHealthy !== null) return _proxyHealthy;
  const c = getHeadroomClient();
  if (!c) return (_proxyHealthy = false);
  try {
    const h = await c.health();
    _proxyHealthy = h?.status === "healthy";
  } catch {
    _proxyHealthy = false;
  }
  return _proxyHealthy;
}

// --- In-memory CCR fallback store ----------------------------------------
// The proxy ships with its own CCR store, but when the proxy is offline we
// keep a tiny client-side mirror so the local LLM can still "expand" a row
// reference back to its full source.
interface CcrEntry {
  hash: string;
  rows: unknown[];
  fetchedAt: number;
}
const _ccr = new Map<string, CcrEntry>();

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export function cacheRowsForCcr(key: string, rows: unknown[]): string {
  const hash = `${key}:${hashString(JSON.stringify(rows).slice(0, 10000))}`;
  _ccr.set(hash, { hash, rows, fetchedAt: Date.now() });
  return hash;
}

export interface CcrRetrieval {
  hash: string;
  rows: unknown[];
  source: "client-cache" | "proxy";
}

export async function retrieveOriginal(hash: string): Promise<CcrRetrieval | null> {
  // 1. Try local client cache first (works offline)
  const local = _ccr.get(hash);
  if (local) return { hash, rows: local.rows, source: "client-cache" };

  // 2. Try the proxy's CCR store if reachable
  const c = getHeadroomClient();
  if (c && (await isProxyReachable())) {
    try {
      // The Headroom proxy exposes /v1/ccr/retrieve; the SDK doesn't have a
      // typed wrapper for it on every version, so we use fetch directly.
      const r = await fetch(`${PROXY_URL.replace(/\/+$/, "")}/v1/ccr/retrieve/${hash}`);
      if (r.ok) {
        const json = (await r.json()) as { originalContent?: string };
        const parsed = json.originalContent ? safeJsonParse(json.originalContent) : null;
        if (parsed) return { hash, rows: Array.isArray(parsed) ? parsed : [parsed], source: "proxy" };
      }
    } catch {
      /* swallow, treat as miss */
    }
  }
  return null;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * Compress a message array before sending to an LLM. Falls back to the
 * original messages when the proxy is unreachable so the assistant keeps
 * working offline.
 */
export async function compressMessages<T extends AnyMessage>(
  messages: T[],
  opts?: { model?: string; tokenBudget?: number },
): Promise<{ messages: T[]; compressed: boolean; result?: CompressResult }> {
  if (!PROXY_URL || !(await isProxyReachable())) {
    return { messages, compressed: false };
  }
  try {
    const result = await compress(messages as unknown as any[], {
      model: opts?.model ?? "local-webllm",
      tokenBudget: opts?.tokenBudget,
    });
    return {
      messages: (result.messages as unknown as T[]) ?? messages,
      compressed: true,
      result,
    };
  } catch (err) {
    console.warn("[headroom] compress failed, sending raw payload", err);
    return { messages, compressed: false };
  }
}
