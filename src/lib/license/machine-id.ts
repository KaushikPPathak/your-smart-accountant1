// Machine fingerprint — a stable random 128-bit id created once per install
// and pinned in localStorage. Because each Windows install has its own
// %LOCALAPPDATA%\com.smartaccountant.app\EBWebView\ profile (see src-tauri/
// src/lib.rs), this id survives app upgrades but is unique per device.
//
// A user copying the whole profile folder to another PC WOULD carry the id
// with them. That's an accepted trade-off — this is honest-buyer DRM, not
// state-actor DRM. The nag banner + watermark are the real deterrent.

const KEY = "sm.machine_id.v1";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getMachineId(): string {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || id.length < 16) {
      id = randomHex(16);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "unknown-machine";
  }
}

/** Short form for display in Settings → License. */
export function getMachineIdShort(): string {
  const id = getMachineId();
  return id.slice(0, 4) + "-" + id.slice(4, 8) + "-" + id.slice(8, 12);
}
