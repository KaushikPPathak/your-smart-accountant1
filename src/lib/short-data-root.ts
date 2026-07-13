// Short, human-friendly data root for user-visible exports & backups.
//
// The frozen WebView profile (IndexedDB) still lives at
//   %LOCALAPPDATA%\com.smartaccountant.app\EBWebView\
// — that path is pinned forever and MUST NOT change. This helper is only
// for user-facing export/backup/GST files that the user opens by hand:
// we want a short, memorable path like  C:\smartaccountant\<Company>\...
// instead of the long %LOCALAPPDATA% one.
//
// Strategy:
//   Windows → try  C:\smartaccountant   (fall back to %USERPROFILE%\smartaccountant
//                                       if C:\ root isn't writable)
//   macOS   → ~/smartaccountant
//   Linux   → ~/smartaccountant

import { isDesktopRuntime } from "./native-bridge";

const FOLDER = "smartaccountant";

function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform
    || navigator.userAgent;
  return /win/i.test(p);
}

let cached: string | null = null;

/**
 * Absolute path to the short data root. Creates it on first call.
 * Returns null in a browser tab.
 */
export async function getShortDataRoot(): Promise<string | null> {
  if (cached) return cached;
  if (!isDesktopRuntime()) return null;
  try {
    const [{ join, homeDir }, fs] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const candidates: string[] = [];
    if (isWindows()) {
      candidates.push(`C:\\${FOLDER}`);
      try { candidates.push(await join(await homeDir(), FOLDER)); } catch { /* ignore */ }
    } else {
      candidates.push(await join(await homeDir(), FOLDER));
    }
    for (const dir of candidates) {
      try {
        await fs.mkdir(dir, { recursive: true });
        cached = dir;
        return dir;
      } catch { /* try next */ }
    }
  } catch { /* fall through */ }
  return null;
}

export function _resetShortDataRootCache(): void {
  cached = null;
}
