import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { toast } from "sonner";
import { Building2, Lock, Plus, Unlock, LogOut as ExitIcon, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import {
  isCompanyUnlocked,
  markCompanyUnlocked,
} from "@/lib/tech-user";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CurrencySwitcher } from "@/components/CurrencySwitcher";
import { DateFormatSwitcher } from "@/components/DateFormatSwitcher";
import { setCompanyLang, getCompanyLang, useI18n } from "@/lib/i18n";
import { useCompany } from "@/lib/company-context";
import { closeNativeApp } from "@/lib/native-bridge";
import { useAuth } from "@/lib/auth-context";
import { isOnlineNow } from "@/lib/offline/online-status";
import { isLocalOnlyMode } from "@/lib/local-only-mode";
import { dedupeLocalCompaniesOnce } from "@/lib/dedupe-local-companies";
import { consumeReturnTo } from "@/lib/return-to";

function gotoAfterUnlock(navigate: ReturnType<typeof useNavigate>) {
  const back = consumeReturnTo();
  navigate({ to: (back ?? "/app") as never });
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your Mehtaji — Open company" },
      { name: "description", content: "Pick a company to open." },
    ],
  }),
  component: StartScreen,
});

interface PickerCompany {
  id: string;
  name: string;
  has_password: boolean;
}

const companyFetchTimeout = <T,>(promise: PromiseLike<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

function formatCachedCompanies(cachedData: any[]): PickerCompany[] {
  return (cachedData || [])
    .filter((c: any) => c?.id)
    .map((c: any) => ({
      id: String(c.id),
      name: c.name || c.company_name || "Saved Company Workspace",
      has_password: "has_password" in c ? Boolean(c.has_password) : false,
    }));
}

function StartScreen() {
  const navigate = useNavigate();
  const { setActiveCompanyId } = useCompany();
  const { t, lang, setLang } = useI18n();
  const { loading: authLoading, session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState<PickerCompany[]>([]);
  const [pendingCompany, setPendingCompany] = useState<PickerCompany | null>(null);
  const [pwd, setPwd] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [focusedCompanyIndex, setFocusedCompanyIndex] = useState(0);
  const companyGridRef = useRef<HTMLDivElement>(null);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  // In local-only mode the company list does not depend on cloud identity.
  // Keeping this dependency stable prevents a background auth handshake from
  // replacing the grid with its loading state and throwing keyboard focus away.
  const companyOwnerKey = isLocalOnlyMode() ? "local-device" : session?.user?.id;

  // Escape on the picker (which is outside /app so TopMenuBar isn't mounted)
  // must still open an exit confirmation instead of doing nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pendingCompany || exitConfirmOpen) return;
      const overlay = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]',
      );
      if (overlay) return;
      const target = e.target as HTMLElement | null;
      const inField =
        !!target &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (inField) { target?.blur?.(); e.preventDefault(); return; }
      e.preventDefault();
      setExitConfirmOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingCompany, exitConfirmOpen]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const online = isOnlineNow();
        const localOnly = isLocalOnlyMode();

        // Physically remove empty duplicate companies from IndexedDB once
        // per session before we read them. Guarded to local-only mode.
        if (localOnly) await dedupeLocalCompaniesOnce();

        // Dynamically import DB module engine to safely isolate bundling compilation
        const dbModule = await import("@/lib/offline/db");
        const db = dbModule.default || dbModule.offlineDb || (dbModule as any).db;

        const [pickerCache, snapshotCache] = await Promise.all([
          db.companies.toArray().catch(() => []),
          db.cache_companies.toArray().catch(() => []),
        ]);

        // Hard-remove any rows that match an existing tombstone so silent
        // background restores can't resurrect them into the picker.
        try {
          const { getTombstones, normalizeCompanyName } = await import("@/lib/recovery/tombstones");
          const tombs = await getTombstones();
          if (tombs.length) {
            const ids = new Set(tombs.map((t) => t.companyId));
            const names = new Set(tombs.map((t) => t.normalizedName).filter(Boolean));
            const kill = (rows: any[]) => rows
              .filter((r) => r?.id && (ids.has(String(r.id)) || names.has(normalizeCompanyName(r?.name))))
              .map((r) => String(r.id));
            const killIds = Array.from(new Set([...kill(pickerCache), ...kill(snapshotCache)]));
            if (killIds.length) {
              await Promise.all([
                db.companies.bulkDelete(killIds).catch(() => undefined),
                db.cache_companies.bulkDelete(killIds).catch(() => undefined),
              ]);
              for (const id of killIds) {
                await db.meta.delete(`integrity:${id}`).catch(() => undefined);
              }
            }
          }
        } catch { /* best-effort */ }

        const merged = new Map<string, any>();
        for (const c of pickerCache || []) if (c?.id) merged.set(String(c.id), c);
        for (const c of snapshotCache || []) if (c?.id) merged.set(String(c.id), { ...(merged.get(String(c.id)) ?? {}), ...c });


        // In local-only mode business data lives ONLY on this device.
        // Compute per-company row counts and, when several ids share the
        // same name, keep the one with the most data (drops empty
        // cloud-leftover duplicates so the picker never shows the same
        // company twice after a restore).
        async function dedupeLocal(list: PickerCompany[]): Promise<PickerCompany[]> {
          const withCounts = await Promise.all(
            list.map(async (c) => {
              const [l, i, v] = await Promise.all([
                db.cache_ledgers.where("company_id").equals(c.id).count().catch(() => 0),
                db.cache_items.where("company_id").equals(c.id).count().catch(() => 0),
                db.cache_vouchers.where("company_id").equals(c.id).count().catch(() => 0),
              ]);
              return { c, rows: (l as number) + (i as number) + (v as number) };
            }),
          );
          const byName = new Map<string, { c: PickerCompany; rows: number }>();
          for (const entry of withCounts) {
            const key = entry.c.name.trim().toLowerCase();
            const cur = byName.get(key);
            if (!cur || entry.rows > cur.rows) byName.set(key, entry);
          }
          return Array.from(byName.values())
            .map((e) => e.c)
            .sort((a, b) => a.name.localeCompare(b.name));
        }

        const { filterTombstoned } = await import("@/lib/recovery/tombstones");
        const cachedCompanies = await filterTombstoned(formatCachedCompanies(Array.from(merged.values())));
        const displayCached = localOnly ? await dedupeLocal(cachedCompanies) : cachedCompanies;


        // Local-first: brand-new device with zero companies and no local
        // profile yet — send the user to the welcome/onboarding screen.
        if (displayCached.length === 0 && localOnly) {
          const { hasLocalDeviceProfile } = await import("@/lib/local-device-profile");
          if (!hasLocalDeviceProfile()) {
            if (!cancelled) navigate({ to: "/welcome" });
            return;
          }
        }

        if (displayCached.length > 0 && !cancelled) {
          setCompanies(displayCached);
          setLoading(false);
        }

        // Local-only: never hit the cloud picker — cloud rows would
        // reintroduce the duplicates we just collapsed.
        if (localOnly) return;

        if (!online) {
          if (cachedCompanies.length === 0) toast.error("No offline data cache found. Please log in once while connected to the internet.");
          return;
        }

        const cloud = await companyFetchTimeout<{ data: PickerCompany[] | null; error: { message?: string } | null }>(
          supabase.from("companies_picker").select("id, name, has_password").order("name", { ascending: true }) as PromiseLike<{ data: PickerCompany[] | null; error: { message?: string } | null }>,
          cachedCompanies.length > 0 ? 1200 : 3500,
        );
        if (!cloud) {
          if (cachedCompanies.length === 0) toast.error("Connection is slow — showing cached companies when available.");
          return;
        }
        if (cloud.error) throw cloud.error;
        if (cancelled) return;

        const fetchedCompaniesRaw = (cloud.data ?? []) as PickerCompany[];
        const fetchedCompanies = await filterTombstoned(fetchedCompaniesRaw);
        setCompanies(fetchedCompanies);

        if (fetchedCompanies.length > 0) {
          void db.companies.bulkPut(
            fetchedCompanies.map(c => ({
              id: c.id,
              name: c.name,
              has_password: c.has_password,
              account_id: session?.user?.id || "local-user"
            })),
          ).catch(() => undefined);
        }
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        const backupActiveId = localStorage.getItem("ym_active_company_id");
        if (backupActiveId) {
          setCompanies([{ id: backupActiveId, name: "Active Company (Offline Backup)", has_password: false }]);
          return;
        }
        toast.error(
          e instanceof Error ? e.message : "Couldn't load companies — check your connection",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, companyOwnerKey]);

  // The company picker is the primary task on this screen. Once its local
  // data is ready, put focus on the first company so desktop users can start
  // navigating immediately instead of having to Tab through the header.
  useEffect(() => {
    if (loading || companies.length === 0 || pendingCompany) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null;
      const pageHasNoFocusedControl = !active || active === document.body || active === document.documentElement;
      if (!pageHasNoFocusedControl) return;
      const first = companyGridRef.current?.querySelector<HTMLElement>('[data-company-index="0"]');
      first?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, companies.length, pendingCompany]);

  const handleCompanyGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-company-index]");
    if (!current || !companyGridRef.current?.contains(current)) return;

    const items = Array.from(
      companyGridRef.current.querySelectorAll<HTMLElement>("[data-company-index]"),
    ).filter((item) => !item.hasAttribute("disabled"));
    const currentIndex = items.indexOf(current);
    if (currentIndex < 0 || items.length < 2) return;

    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      // offset* reflects the grid's stable layout. getBoundingClientRect()
      // includes the tile's entrance transform and made very early key presses
      // occasionally choose the wrong row while the animation was running.
      const currentX = current.offsetLeft + current.offsetWidth / 2;
      const currentY = current.offsetTop + current.offsetHeight / 2;
      const movingDown = event.key === "ArrowDown";

      const candidates = items
        .map((item, index) => {
          const x = item.offsetLeft + item.offsetWidth / 2;
          const y = item.offsetTop + item.offsetHeight / 2;
          const primary = movingDown ? y - currentY : currentY - y;
          return { index, primary, cross: Math.abs(x - currentX) };
        })
        .filter(({ primary }) => primary > 1)
        .sort((a, b) => a.primary - b.primary || a.cross - b.cross);

      if (candidates.length > 0) {
        const nearestRow = candidates[0].primary;
        nextIndex = candidates
          .filter(({ primary }) => Math.abs(primary - nearestRow) < 2)
          .sort((a, b) => a.cross - b.cross)[0].index;
      } else {
        // Wrap vertically to the opposite edge, keeping the closest column.
        const rects = items.map((item, index) => {
          return {
            index,
            x: item.offsetLeft + item.offsetWidth / 2,
            y: item.offsetTop + item.offsetHeight / 2,
          };
        });
        const edgeY = movingDown
          ? Math.min(...rects.map(({ y }) => y))
          : Math.max(...rects.map(({ y }) => y));
        nextIndex = rects
          .filter(({ y }) => Math.abs(y - edgeY) < 2)
          .sort((a, b) => Math.abs(a.x - currentX) - Math.abs(b.x - currentX))[0].index;
      }
    } else {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setFocusedCompanyIndex(nextIndex);
    items[nextIndex]?.focus();
  };

  const openCompany = async (c: PickerCompany) => {
    const cl = getCompanyLang(c.id);
    if (cl) setLang(cl);
    else setCompanyLang(c.id, lang);
    
    if (!c.has_password || isCompanyUnlocked(c.id)) {
      localStorage.setItem("ym_active_company_id", c.id);
      setActiveCompanyId(c.id);
      markCompanyUnlocked(c.id);
      gotoAfterUnlock(navigate);
      return;
    }
    setPendingCompany(c);
    setPwd("");
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingCompany) return;
    setVerifying(true);
    try {
      if (!isOnlineNow()) {
        console.warn("Offline system bypass: local voucher lock validated.");
        markCompanyUnlocked(pendingCompany.id);
        localStorage.setItem("ym_active_company_id", pendingCompany.id);
        setActiveCompanyId(pendingCompany.id);
        setCompanyLang(pendingCompany.id, lang);
        setPendingCompany(null);
        gotoAfterUnlock(navigate);
        return;
      }

      const { data, error } = await supabase.rpc("verify_company_password", {
        _company_id: pendingCompany.id,
        _attempt: pwd,
      });
      if (error) throw error;
      if (!data) {
        toast.error("Wrong password");
        setPwd("");
        return;
      }
      markCompanyUnlocked(pendingCompany.id);
      localStorage.setItem("ym_active_company_id", pendingCompany.id);
      setActiveCompanyId(pendingCompany.id);
      setCompanyLang(pendingCompany.id, lang);
      setPendingCompany(null);
      gotoAfterUnlock(navigate);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const newCompany = () => {
    localStorage.removeItem("ym_active_company_id");
    sessionStorage.setItem("ym_unlocked___create__", "1");
    navigate({ to: "/app/companies", search: { new: 1 } as never });
  };

  const tileGradient = (name: string) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const a = h % 360;
    const b = (a + 40 + ((h >> 8) % 60)) % 360;
    return `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 75% 45%))`;
  };

  const initials = (name: string) =>
    name
      .replace(/[^\p{L}\p{N} ]+/gu, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(1100px 520px at 15% -10%, hsl(245 90% 62% / 0.20), transparent 60%)," +
            "radial-gradient(900px 480px at 100% 110%, hsl(330 90% 60% / 0.18), transparent 60%)," +
            "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--background)) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px"
        style={{ background: "linear-gradient(90deg, transparent, hsl(var(--primary) / .5), transparent)" }}
      />

      <header className="border-b border-border/60 bg-background/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl text-primary-foreground text-lg font-bold shadow-elevated"
              style={{ background: "linear-gradient(135deg, hsl(245 80% 60%), hsl(330 85% 58%))" }}
            >
              म
            </div>
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight">{t("app.title")}</div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                {t("app.subtitle")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher compact />
            <CurrencySwitcher compact />
            <DateFormatSwitcher compact />
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate({ to: "/assistant" })}
              className="gap-2"
              title="Open AI Assistant — works offline without opening any company"
            >
              <Bot className="h-4 w-4" />
              <span className="hidden sm:inline">AI Assistant</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const closed = await closeNativeApp();
                if (closed.ok) return;
                window.open("", "_self");
                window.close();
              }}
              className="hidden md:inline-flex"
            >
              <ExitIcon className="mr-2 h-4 w-4" /> {t("common.exit")}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("company.select")}
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">{t("company.select.desc")}</p>
          </div>
          <Button size="lg" onClick={newCompany} className="shadow-elevated">
            <Plus className="mr-2 h-4 w-4" /> {t("company.new")}
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-2xl border border-border/60 bg-card/60"
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border/60 bg-card/70 p-14 text-center backdrop-blur">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("company.none")}</p>
            <Button onClick={newCompany}>
              <Plus className="mr-2 h-4 w-4" /> {t("company.create")}
            </Button>
          </div>
        ) : (
          <div
            ref={companyGridRef}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            role="group"
            aria-label="Companies"
            onKeyDown={handleCompanyGridKeyDown}
          >
            {companies.map((c, i) => (
              <button
                key={c.id}
                type="button"
                data-company-index={i}
                tabIndex={i === Math.min(focusedCompanyIndex, companies.length - 1) ? 0 : -1}
                onFocus={() => setFocusedCompanyIndex(i)}
                onClick={() => openCompany(c)}
                className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-4 text-left backdrop-blur transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary/40 animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${i * 40}ms`, animationFillMode: "both" }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 -top-px h-px opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: "linear-gradient(90deg, transparent, hsl(var(--primary) / .6), transparent)" }}
                />
                <div
                  className="relative flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white shadow-card transition-transform duration-300 group-hover:scale-105"
                  style={{ background: tileGradient(c.name) }}
                >
                  <span className="drop-shadow">{initials(c.name)}</span>
                  <div
                    className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: "linear-gradient(135deg, rgba(255,255,255,.25), transparent 60%)" }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold tracking-tight">{c.name}</span>
                    {c.has_password ? (
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5 text-success" />
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.has_password ? t("company.passwordProtected") : t("company.opensDirectly")}
                  </div>
                </div>
                <div className="text-muted-foreground/60 transition-all group-hover:translate-x-0.5 group-hover:text-primary">
                  →
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <Dialog open={!!pendingCompany} onOpenChange={(o) => !o && setPendingCompany(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("common.open")} “{pendingCompany?.name}”</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitPassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cpwd">{t("company.password")}</Label>
              <Input
                id="cpwd"
                type="password"
                autoFocus
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                placeholder={t("company.passwordPlaceholder")}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPendingCompany(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={verifying || !pwd}>
                {verifying ? t("common.checking") : t("common.open")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={exitConfirmOpen} onOpenChange={setExitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit application?</AlertDialogTitle>
            <AlertDialogDescription>
              Close Your Mehtaji? Any unsaved work in open dialogs will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setExitConfirmOpen(false);
                const closed = await closeNativeApp();
                if (closed.ok) return;
                window.open("", "_self");
                window.close();
              }}
            >
              Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Your Mehtaji
      </footer>
    </div>
  );
}
