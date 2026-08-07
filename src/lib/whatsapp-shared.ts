// src/lib/whatsapp-shared.ts
// Shared utilities for all WhatsApp integrations.
// No business logic — just Tauri bridge, audio, phone sanitisation, and window focus.

import { getNativeRuntime } from "@/lib/native-bridge";
import { recordFailure, recordStage } from "@/lib/crash-log";
export { getNativeRuntime };

export type Invoke = <T = unknown>(cmd: string, args?: unknown) => Promise<T>;

export async function resolveInvoke(): Promise<Invoke | null> {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: { core?: { invoke?: Invoke }; tauri?: { invoke?: Invoke }; invoke?: Invoke };
  };
  const globalInvoke =
    w.__TAURI__?.core?.invoke ?? w.__TAURI__?.tauri?.invoke ?? w.__TAURI__?.invoke;
  if (typeof globalInvoke === "function") return globalInvoke;

  try {
    const m = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as { invoke?: Invoke };
    if (typeof m?.invoke === "function") return m.invoke;
  } catch {
    /* not a v2 runtime */
  }
  return null;
}

export async function copyFilesToClipboardNative(paths: string[]): Promise<boolean> {
  const runtime = getNativeRuntime();
  recordStage("whatsapp", "bridge", {
    runtime,
    path_count: paths.length,
  });
  if (runtime !== "tauri" || !paths.length) {
    recordFailure("whatsapp", new Error(
      runtime !== "tauri"
        ? `Native clipboard unavailable in ${runtime} runtime`
        : "No file paths supplied to clipboard copy",
    ), { stage: "bridge", runtime });
    return false;
  }
  try {
    const invoke = await resolveInvoke();
    if (!invoke) {
      recordFailure("whatsapp", new Error("Tauri invoke not found — native command bridge missing"), {
        stage: "bridge",
        runtime,
      });
      return false;
    }

    // Normalize and validate paths to ensure they are absolute filesystem paths
    const rejected: string[] = [];
    const validPaths = paths.filter((p) => {
      if (typeof p !== "string" || p.length === 0) { rejected.push(String(p)); return false; }

      // Reject URLs
      if (/^(blob:|data:|http:|https:)/i.test(p)) { rejected.push(`url:${p}`); return false; }

      // Enforce absolute path pattern (Windows drive or root slash)
      if (!/^([a-zA-Z]:[\\\/]|\\\\|\/)/.test(p)) { rejected.push(`relative:${p}`); return false; }

      return true;
    });

    recordStage("whatsapp", "path-check", {
      valid: validPaths,
      rejected,
    });

    if (!validPaths.length) {
      recordFailure("whatsapp", new Error("No valid absolute filesystem paths to copy"), {
        stage: "path-check",
        rejected,
      });
      return false;
    }

    const result = await (invoke as Invoke)("copy_files_to_clipboard", { paths: validPaths });
    recordStage("whatsapp", "clipboard", { ok: true, result: result ?? null });
    return true;
  } catch (err) {
    recordFailure("whatsapp", err, {
      stage: "clipboard",
      command: "copy_files_to_clipboard",
      runtime,
      paths,
    });
    return false;
  }
}


export function playSuccessBeep() {
  try {
    const Ctx =
      (window as any).AudioContext ||
      (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* ignore audio policy blocks */
  }
}

export function sanitizePhoneForWhatsApp(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/[^0-9+]/g, "");
  digits = digits.replace(/^\+/, "").replace(/^00/, "");
  digits = digits.replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length < 10 || digits.length > 15) return "";
  return digits;
}

export function buildWhatsAppWebUrl(phone: string, message: string): string {
  const encodedText = encodeURIComponent(message);
  // Using api.whatsapp.com for broad compatibility, including embedded views.
  if (phone) {
    return `https://api.whatsapp.com/send?phone=${phone}&text=${encodedText}`;
  }
  return `https://api.whatsapp.com/send?text=${encodedText}`;
}

/**
 * Reuse the embedded WhatsApp Web window via Tauri.
 * Throws if Tauri is unavailable so the caller can toast instead of silently failing.
 */
export async function showWhatsAppWeb(url: string): Promise<void> {
  const runtime = getNativeRuntime();
  if (runtime !== "tauri") {
    throw new Error("WhatsApp sharing is only available in the desktop app.");
  }
  const invoke = await resolveInvoke();
  if (!invoke) throw new Error("Tauri runtime not available.");
  console.log("Opening WhatsApp URL native:", url);
  await (invoke as any)("show_whatsapp_web", { url });

}
