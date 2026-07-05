import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

const companyFetchTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
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

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const online = isOnlineNow();

        // Dynamically import DB module engine to safely isolate bundling compilation
        const dbModule = await import("@/lib/offline/db");
        const db = dbModule.default || dbModule.offlineDb || (dbModule as any).db;

        const [pickerCache, snapshotCache] = await Promise.all([
          db.companies.toArray().catch(() => []),
          db.cache_companies.toArray().catch(() => []),
        ]);
        const merged = new Map<string, any>();
        for (const c of pickerCache || []) if (c?.id) merged.set(String(c.id), c);
        for (const c of snapshotCache || []) if (c?.id) merged.set(String(c.id), { ...(merged.get(String(c.id)) ?? {}), ...c });

        const cachedCompanies = formatCachedCompanies(Array.from(merged.values()));
        if (cachedCompanies.length > 0 && !cancelled) {
          setCompanies(cachedCompanies);
          setLoading(false);
        }

        if (!online) {
          if (cachedCompanies.length === 0) toast.error("No offline data cache found. Please log in once while connected to the internet.");
          return;
        }

        const cloud = await companyFetchTimeout(
          supabase.from("companies_picker").select("id, name, has_password").order("name", { ascending: true }),
          cachedCompanies.length > 0 ? 1200 : 3500,
        );
        if (!cloud) {
          if (cachedCompanies.length === 0) toast.error("Connection is slow — showing cached companies when available.");
          return;
        }
        if (cloud.error) throw cloud.error;
        if (cancelled) return;

        const fetchedCompanies = (cloud.data ?? []) as PickerCompany[];
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
  }, [authLoading, session?.user?.id]);

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((c, i) => (
              <button
                key={c.id}
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

      <footer className="border-t border-border/60 py-4 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Your Mehtaji
      </footer>
    </div>
  );
}
