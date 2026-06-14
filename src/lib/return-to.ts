// Tiny helper to remember the deep route the user was on before being
// redirected to the company picker or sign-in screen, so they land back
// where they left off after unlocking.

const KEY = "ym_return_to";

export function rememberReturnTo(pathWithSearch: string) {
  try {
    if (!pathWithSearch.startsWith("/app")) return;
    // Don't remember screens that are themselves redirect targets / pickers
    if (pathWithSearch === "/app" || pathWithSearch.startsWith("/app/companies")) return;
    sessionStorage.setItem(KEY, pathWithSearch);
  } catch { /* ignore */ }
}

export function consumeReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
