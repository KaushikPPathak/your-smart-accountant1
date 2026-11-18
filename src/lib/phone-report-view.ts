// In-app report view for the Android app.
//
// Why not the iframe preview: an iframe copy of the report keeps its links and
// buttons, which can navigate the iframe (and then the whole app shows inside
// it with no way back), and the system print service leaves the app and does
// not return. So on Android a report opens in a full-screen layer of the same
// page: a sticky bar with Close (and Save & share PDF when offered), the
// Android Back button closes it, and the copied report has no links, buttons
// or forms that can navigate away.
import { isAndroidTauri } from "./native-bridge";

const OVERLAY_ID = "phone-report-view";

export interface PhoneReportViewOptions {
  /** Element to show. It is copied and cleaned; the live page is not changed. */
  content: HTMLElement;
  heading: string;
  /** When given, the bar shows "Save & share PDF" calling this. */
  onSharePdf?: () => void;
}

function buttonStyle(primary: boolean): string {
  return [
    "min-height:44px",
    "padding:0 14px",
    "border-radius:8px",
    "font-size:14px",
    "font-weight:600",
    "white-space:nowrap",
    primary ? "background:#002060;color:#fff;border:0" : "background:#fff;color:#111;border:1px solid #999",
  ].join(";");
}

/** Copy of the report with everything that could navigate or act removed. */
export function cleanReportForPhone(source: HTMLElement): HTMLElement {
  const root = source.cloneNode(true) as HTMLElement;
  root.querySelectorAll("input, textarea").forEach((el) => {
    const span = document.createElement("span");
    span.textContent = (el as HTMLInputElement).value || "";
    el.replaceWith(span);
  });
  root.querySelectorAll("select").forEach((el) => {
    const sel = el as HTMLSelectElement;
    const span = document.createElement("span");
    span.textContent = sel.options[sel.selectedIndex]?.text ?? "";
    sel.replaceWith(span);
  });
  root
    .querySelectorAll("button, a, form, iframe, script, [data-print-hide], .no-print")
    .forEach((el) => el.remove());
  // Print transforms (fit-to-width scaling) would shrink the copy on a phone.
  root.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (el.style.transform) el.style.transform = "none";
  });
  return root;
}

/** Close the in-app report view if it is open. */
export function closePhoneReportView(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Open the report full screen inside the app. Close, the Escape key and the
 * Android Back button all return to the page the user was on.
 */
export function openPhoneReportView(opts: PhoneReportViewOptions): void {
  closePhoneReportView();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", opts.heading);
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:#fff;color:#111;display:flex;flex-direction:column;";

  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;gap:8px;flex:none;padding:calc(env(safe-area-inset-top,0px) + 8px) 12px 8px;border-bottom:1px solid #ddd;background:#fff;";

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "← Close";
  close.setAttribute("aria-label", "Close report");
  close.style.cssText = buttonStyle(false);

  const title = document.createElement("div");
  title.textContent = opts.heading;
  title.style.cssText =
    "flex:1;min-width:0;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

  bar.append(close, title);

  if (opts.onSharePdf) {
    const share = document.createElement("button");
    share.type = "button";
    share.textContent = "Save & share PDF";
    share.style.cssText = buttonStyle(true);
    const onShare = opts.onSharePdf;
    share.addEventListener("click", () => onShare());
    bar.append(share);
  }

  const body = document.createElement("div");
  body.style.cssText = "flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px;";
  body.append(cleanReportForPhone(opts.content));

  overlay.append(bar, body);
  document.body.appendChild(overlay);

  let open = true;
  const teardown = () => {
    if (!open) return;
    open = false;
    window.removeEventListener("popstate", onPop);
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  // Android Back pops the history entry we pushed: close the view instead of leaving the app.
  const onPop = () => teardown();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeWithButton();
  };
  const closeWithButton = () => {
    if (!open) return;
    const ours = (history.state as { ymReportView?: boolean } | null)?.ymReportView === true;
    if (ours) history.back();
    else teardown();
  };

  close.addEventListener("click", closeWithButton);
  document.addEventListener("keydown", onKey);
  history.pushState({ ...(history.state ?? {}), ymReportView: true }, "");
  window.addEventListener("popstate", onPop);
}

/**
 * Android only: window.print() would send the report to the system print
 * service, which takes the user out of the app. Replace it with the in-app view
 * of the current report, so every print control (including ones not yet
 * written) stays inside the app.
 */
export function installAndroidPrintGuard(): void {
  if (typeof window === "undefined" || !isAndroidTauri()) return;
  window.print = () => {
    const root = (document.querySelector("[data-report-view]")
      ?? document.querySelector(".report-print-root")
      ?? document.querySelector("main")) as HTMLElement | null;
    if (!root) return;
    const share = (window as unknown as { __ymReportSharePdf?: () => void }).__ymReportSharePdf;
    openPhoneReportView({ content: root, heading: document.title || "Report", onSharePdf: share });
  };
}
