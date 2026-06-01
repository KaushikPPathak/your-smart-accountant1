import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Send, Sparkles, ArrowRight, Sun, Moon, Languages, Building2, Check, X, Pencil, Loader2, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/lib/theme-context";
import { useI18n, type LangCode } from "@/lib/i18n";
import { searchKb } from "@/lib/assistant-engine";
import {
  ASSISTANT_KB,
  KB_CATEGORIES,
  type AssistantAction,
  type KbEntry,
} from "@/lib/assistant-knowledge";
import { assistantChat, assistantDraftVoucher } from "@/lib/assistant.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";
import { INDIAN_STATES } from "@/lib/constants";
import {
  detectVoucherIntent,
  fetchContextLedgers,
  intentToRoute,
  writeAssistantPrefill,
  type VoucherIntent,
} from "@/lib/voucher-intent";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  matches?: KbEntry[];
  preview?: ParsedCompany;
  toolCalls?: { name: string; input: string }[];
}

type ParsedCompany = {
  name?: string;
  gstin?: string;
  pan?: string;
  state?: string;
  state_code?: string;
  phone?: string;
  email?: string;
  address?: string;
  financial_year_start?: string;
  inventory_enabled?: boolean;
};

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text:
    "Hi! I'm **Mate**, your in-app accounting assistant.\n\nI can:\n- **Read** your books — balances, P&L, trial balance, outstanding, GST data\n- **Draft entries** — ledgers, journals, payments, receipts (I always show a preview and wait for your **yes** before posting)\n- **Guide you** through any setting or screen\n\nTry: *“pay ₹5,000 rent to Sharma from HDFC bank today”*, *“create ledger Electricity Expenses”*, or *“show my receivables”*.",
};

const SUGGESTIONS = [
  "How do I create a sales invoice?",
  "Import from Tally / Busy",
  "Switch to dark mode",
  "Where is GSTR-3B?",
  "Backup my company",
  "Invite a team member",
];

export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeCat, setActiveCat] = useState<KbEntry["category"] | "All">("All");
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { setLang } = useI18n();
  const { user } = useAuth();
  const { memberships, activeCompanyId, setActiveCompanyId, refresh } = useCompany();
  const hasCompany = memberships.length > 0;
  const [creating, setCreating] = useState(false);
  const [pendingCompany, setPendingCompany] = useState<ParsedCompany | null>(null);
  const [aiMode, setAiMode] = useState(true);
  const [thinking, setThinking] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // 🛠️ Switched to clean client invocation (TanStack Start useServerFn removed)
  const callAssistant = assistantChat;
  const callDraftVoucher = assistantDraftVoucher;

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const browseEntries = useMemo(() => {
    if (activeCat === "All") return ASSISTANT_KB;
    return ASSISTANT_KB.filter((e) => e.category === activeCat);
  }, [activeCat]);

  // ---- Company creation intent ----------------------------------------------
  const COMPANY_HELP_TEXT =
    "**Create a company**\n\nI can create one for you right here. Just paste the details (any order works). The only **required** field is the company name — everything else can be added later.\n\n**You can include:**\n- **Name** (required) — e.g. *Name: ABC Traders*\n- **GSTIN** (15 chars) — auto-detects state & marks you as Registered\n- **PAN** (10 chars)\n- **State** — e.g. *State: Maharashtra* or *State code: 27*\n- **Phone**, **Email**, **Address**\n- **FY start** — e.g. *FY: 2025-04-01* (defaults to 1-Apr current year)\n- **Inventory: yes/no** (default yes)\n\n**Example — paste this and edit:**\n`Name: ABC Traders, GSTIN: 27ABCDE1234F1Z5, PAN: ABCDE1234F, Phone: 9876543210, Email: hi@abc.in, Address: 12 MG Road Pune, Inventory: yes`";

  function detectCreateCompanyIntent(t: string): boolean {
    const s = t.toLowerCase();
    return (
      /\b(create|add|new|make|setup|set up|register)\b/.test(s) &&
      /\b(company|firm|business|organi[sz]ation)\b/.test(s)
    );
  }

  function parseCompanyDetails(text: string): ParsedCompany | null {
    const out: Record<string, unknown> = {};
    const kvRe = /\b(name|company|firm|gstin|gst|pan|state code|state_code|state|phone|mobile|email|mail|address|addr|fy|financial year|inventory|stock)\s*[:=\-]\s*([^,\n]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = kvRe.exec(text)) !== null) {
      const k = m[1].toLowerCase().trim();
      const v = m[2].trim();
      if (!v) continue;
      if (k === "name" || k === "company" || k === "firm") out.name = v;
      else if (k === "gstin" || k === "gst") out.gstin = v.toUpperCase().replace(/\s+/g, "");
      else if (k === "pan") out.pan = v.toUpperCase().replace(/\s+/g, "");
      else if (k === "state code" || k === "state_code") out.state_code = v.replace(/[^0-9]/g, "");
      else if (k === "state") out.state = v;
      else if (k === "phone" || k === "mobile") out.phone = v;
      else if (k === "email" || k === "mail") out.email = v;
      else if (k === "address" || k === "addr") out.address = v;
      else if (k === "fy" || k === "financial year") out.financial_year_start = v;
      else if (k === "inventory" || k === "stock")
        out.inventory_enabled = /^(y|yes|true|on|1|enable)/i.test(v);
    }

    const gstRe = /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/i;
    const gstMatch = text.toUpperCase().match(gstRe);
    if (!out.gstin && gstMatch) out.gstin = gstMatch[1];

    const panRe = /\b([A-Z]{5}[0-9]{4}[A-Z])\b/;
    const panMatch = text.toUpperCase().match(panRe);
    if (!out.pan && panMatch) out.pan = panMatch[1];

    const emailRe = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
    const emailMatch = text.match(emailRe);
    if (!out.email && emailMatch) out.email = emailMatch[0];

    const phoneRe = /\b([6-9]\d{9})\b/;
    const phoneMatch = text.replace(/\s|-/g, "").match(phoneRe);
    if (!out.phone && phoneMatch) out.phone = phoneMatch[1];

    if (!out.state_code && typeof out.gstin === "string" && out.gstin.length >= 2) {
      out.state_code = out.gstin.slice(0, 2);
    }
    if (out.state_code && !out.state) {
      const found = INDIAN_STATES.find((s) => s.code === out.state_code);
      if (found) out.state = found.name;
    }
    if (!out.state_code && typeof out.state === "string") {
      const found = INDIAN_STATES.find(
        (s) => s.name.toLowerCase() === (out.state as string).toLowerCase(),
      );
      if (found) out.state_code = found.code;
    }

    return Object.keys(out).length === 0 ? null : (out as ParsedCompany);
  }

  async function confirmCreateCompany(parsed: ParsedCompany) {
    if (!parsed.name) {
      toast.error("Company name is required");
      return;
    }
    if (!user) {
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: "You need to be signed in to create a company. Please sign in first.",
        },
      ]);
      return;
    }
    setCreating(true);
    try {
      const isGst = !!parsed.gstin && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(parsed.gstin);
      const payload = {
        name: parsed.name,
        gstin: isGst ? parsed.gstin! : null,
        pan: parsed.pan ?? null,
        state: parsed.state ?? null,
        state_code: parsed.state_code ?? null,
        address: parsed.address ?? null,
        email: parsed.email ?? null,
        phone: parsed.phone ?? null,
        financial_year_start:
          parsed.financial_year_start || `${new Date().getFullYear()}-04-01`,
        gst_registered: isGst,
        gst_filing_frequency: "monthly" as const,
        inventory_enabled: parsed.inventory_enabled ?? true,
        annual_turnover_paise: 0,
        created_by: user.id,
      };
      const { data, error } = await supabase
        .from("companies")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (error || !data) {
        setMessages((m) => [
          ...m,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            text: `I couldn't create the company: **${error?.message ?? "Unknown error"}**.\n\nYou can also open the full form with the button below.`,
            matches: [
              {
                id: "open-create",
                category: "Settings",
                title: "Open create company form",
                answer: "",
                keywords: [],
                actions: [{ kind: "navigate", to: "/app/companies?new=1", label: "Open form" }],
              } as KbEntry,
            ],
          },
        ]);
        return;
      }
      setActiveCompanyId(data.id);
      await refresh();
      toast.success(`Company "${parsed.name}" created`);
      setPendingCompany(null);
      const summary = [
        `**${parsed.name}** is ready 🎉`,
        parsed.gstin ? `- GSTIN: \`${parsed.gstin}\`` : null,
        parsed.pan ? `- PAN: \`${parsed.pan}\`` : null,
        parsed.state ? `- State: ${parsed.state}${parsed.state_code ? ` (${parsed.state_code})` : ""}` : null,
        parsed.phone ? `- Phone: ${parsed.phone}` : null,
        parsed.email ? `- Email: ${parsed.email}` : null,
        `\nYou can fine-tune anything later from **Company Settings**.`,
      ]
        .filter(Boolean)
        .join("\n");
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: summary,
          matches: [
            {
              id: "post-create",
              category: "Settings",
              title: "Post create",
              answer: "",
              keywords: [],
              actions: [
                { kind: "navigate", to: "/app", label: "Open dashboard" },
                { kind: "navigate", to: "/app/settings", label: "Company settings" },
                { kind: "navigate", to: "/app/ledgers", label: "Add ledgers" },
              ],
            } as KbEntry,
          ],
        },
      ]);
    } finally {
      setCreating(false);
    }
  }

  function ask(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((m) => [...m, userMsg]);
    if (inputRef.current) inputRef.current.value = "";

    void (async () => {
      const parsed = parseCompanyDetails(text);
      if (parsed && parsed.name) {
        setPendingCompany(parsed);
        const preview: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text:
            "Here's what I understood from your message. Please review the details below — I'll only create the company after you confirm.",
          preview: parsed,
        };
        setMessages((m) => [...m, preview]);
        return;
      }

      if (detectCreateCompanyIntent(text) || (!hasCompany && /company/i.test(text))) {
        const guide: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: COMPANY_HELP_TEXT,
          matches: [
            {
              id: "open-create-form",
              category: "Settings",
              title: "Open create company form",
              answer: "",
              keywords: [],
              actions: [
                { kind: "navigate", to: "/app/companies?new=1", label: "Open full form" },
              ],
            } as KbEntry,
          ],
        };
        setMessages((m) => [...m, guide]);
        return;
      }

      const intent: VoucherIntent | null = activeCompanyId
        ? detectVoucherIntent(text)
        : null;
      if (intent && activeCompanyId && user) {
        setThinking(true);
        try {
          const ledgers = await fetchContextLedgers(supabase, activeCompanyId, intent);
          const res = await callDraftVoucher({
            data: {
              voucherType: intent,
              text,
              today: new Date().toISOString().slice(0, 10),
              ledgers,
            },
          });
          if (res.ok && res.draft) {
            const d = res.draft;
            writeAssistantPrefill({
              voucherType: intent,
              date: d.date,
              partyLedgerId: d.partyLedgerId ?? undefined,
              cashBankLedgerId: d.cashBankLedgerId ?? undefined,
              counterLedgerId: d.counterLedgerId ?? undefined,
              amount: d.amount,
              narration: d.narration,
              refNo: d.refNo,
            });
            setMessages((m) => [
              ...m,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: `Drafted a **${intent}** voucher — opening the form. Press **Enter** to save (or Ctrl+S).`,
              },
            ]);
            setThinking(false);
            navigate({ to: intentToRoute(intent) });
            return;
          }
          if (!res.ok && res.error) toast.error(res.error);
        } catch (err) {
          console.error("[assistant.draft] failed", err);
        } finally {
          setThinking(false);
        }
      }

      if (aiMode && user) {
        setThinking(true);
        try {
          const history = [...messages, userMsg]
            .filter((m) => m.id !== "welcome")
            .slice(-12)
            .map((m) => ({ role: m.role, content: m.text }));
          const res = await callAssistant({
            data: { companyId: activeCompanyId ?? null, messages: history },
          });
          if (res.ok && res.text) {
            setMessages((m) => [
              ...m,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: res.text,
                toolCalls: res.toolCalls,
              },
            ]);
            return;
          }
          if (!res.ok && res.error) {
            toast.error(res.error);
          }
        } catch (err) {
          console.error("[assistant] call failed", err);
          toast.error("AI unavailable, falling back to offline guide.");
        } finally {
          setThinking(false);
        }
      }

      const matches = searchKb(text, { limit: 3 });
      let reply: ChatMessage;
      if (matches.length === 0) {
        reply = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text:
            "I couldn't find that in my offline knowledge yet. Try different words, or browse topics from the panel on the right. You can also ask about: vouchers, GST returns, ledgers, items, backup, Tally import, settings, theme, or language.",
        };
      } else {
        const top = matches[0].entry;
        const more =
          matches.length > 1
            ? `\n\n_Related:_ ${matches.slice(1).map((m) => `**${m.entry.title}**`).join(" · ")}`
            : "";
        reply = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: `**${top.title}**\n\n${top.answer}${more}`,
          matches: matches.map((m) => m.entry),
        };
      }
      setMessages((m) => [...m, reply]);

    })();
  }

  function runAction(a: AssistantAction) {
    if (a.kind === "navigate" && a.to) {
      if (a.to.includes("?") && typeof window !== "undefined") {
        window.location.href = a.to;
      } else {
        navigate({ to: a.to });
      }
      toast.success(`Opening ${a.label}`);
    } else if (a.kind === "set-theme" && a.theme) {
      setTheme(a.theme);
      toast.success(`Theme set to ${a.theme}`);
    } else if (a.kind === "set-language" && a.lang) {
      setLang(a.lang as LangCode);
      toast.success(`Language set to ${a.label}`);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card className="flex h-[calc(100vh-12rem)] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Mate — your in-app assistant</span>
            <span className="text-[11px] text-muted-foreground">
              {aiMode
                ? "AI-powered · reads your books AND can draft entries (always previews before posting)"
                : "Offline guide · settings, screens & options"}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant={aiMode ? "default" : "outline"}
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => setAiMode((v) => !v)}
              title="Toggle AI mode"
            >
              <Sparkles className="h-3 w-3" />
              {aiMode ? "AI on" : "AI off"}
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div ref={scrollerRef} className="flex flex-col gap-3 p-4">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                msg={m}
                onAction={runAction}
                onConfirmCompany={confirmCreateCompany}
                onCancelCompany={() => {
                  setPendingCompany(null);
                  setMessages((mm) => [
                    ...mm,
                    {
                      id: `a-${Date.now()}`,
                      role: "assistant",
                      text:
                        "No problem — I won't create it. Send a new message with corrected details, or open the full form to fine-tune.",
                    },
                  ]);
                }}
                creating={creating}
                isPending={!!pendingCompany && m.preview === pendingCompany}
              />
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Mate is thinking…
              </div>
            )}
          </div>
        </ScrollArea>

        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
            {(hasCompany
              ? SUGGESTIONS
              : [
                  "Create a company",
                  "What info do I need to create a company?",
                  "Open the create-company form",
                  ...SUGGESTIONS,
                ]
            ).map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className="h-7 rounded-full text-xs"
                onClick={() => ask(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        )}

        {!hasCompany && messages.length <= 1 && (
          <div className="mx-3 mb-2 flex items-center gap-3 rounded-md border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="flex-1">
              You don't have a company yet. I can create one for you — type the
              details, or open the form.
            </span>
            <Button
              size="sm"
              variant="default"
              className="h-7 text-xs"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.href = "/app/companies?new=1";
                } else {
                  navigate({ to: "/app/companies" });
                }
              }}
            >
              Create company
            </Button>
          </div>
        )}

        <form
          className="flex items-end gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(inputRef.current?.value ?? "");
          }}
        >
          <Textarea
            ref={inputRef}
            defaultValue=""
            rows={2}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 240) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                ask(inputRef.current?.value ?? "");
                if (inputRef.current) inputRef.current.style.height = "auto";
              }
            }}
            placeholder={
              hasCompany
                ? "Ask anything… Enter to send, Shift+Enter for new line. Paste multi-line details freely."
                : "Type or paste: Name: ABC Traders\nGSTIN: 27ABCDE1234F1Z5\nPhone: 9876543210"
            }
            autoFocus
            disabled={creating || thinking}
            className="min-h-[60px] max-h-[240px] resize-none text-sm"
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={creating || thinking}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </Card>

      <Card className="hidden h-[calc(100vh-12rem)] flex-col lg:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">Browse topics</div>
          <div className="text-[11px] text-muted-foreground">
            {ASSISTANT_KB.length} guides · 100% local
          </div>
        </div>
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {(["All", ...KB_CATEGORIES] as const).map((c) => (
            <Button
              key={c}
              variant={activeCat === c ? "default" : "ghost"}
              size="sm"
              className="h-6 rounded-full px-2 text-[11px]"
              onClick={() => setActiveCat(c)}
            >
              {c}
            </Button>
          ))}
        </div>
        <ScrollArea className="flex-1">
          <CardContent className="space-y-1 p-2">
            {browseEntries.map((e) => (
              <button
                key={e.id}
                onClick={() => ask(e.title)}
                className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                <span className="truncate">{e.title}</span>
                <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  );
}

function MessageBubble({
  msg,
  onAction,
  onConfirmCompany,
  onCancelCompany,
  creating,
  isPending,
}: {
  msg: ChatMessage;
  onAction: (a: AssistantAction) => void;
  onConfirmCompany: (p: ParsedCompany) => void;
  onCancelCompany: () => void;
  creating: boolean;
  isPending: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <RichText text={msg.text} />
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {msg.toolCalls.map((tc, i) => (
              <Badge key={i} variant="outline" className="gap-1 text-[10px]">
                <Wrench className="h-2.5 w-2.5" /> {tc.name}
              </Badge>
            ))}
          </div>
        )}

        {!isUser && msg.preview && (
          <CompanyPreviewCard
            parsed={msg.preview}
            disabled={!isPending || creating}
            creating={creating}
            onConfirm={() => onConfirmCompany(msg.preview!)}
            onCancel={onCancelCompany}
          />
        )}
        {!isUser && msg.matches && msg.matches[0]?.actions && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {msg.matches[0].actions.map((a, i) => (
              <Button
                key={i}
                size="sm"
                variant="secondary"
                className="h-7 gap-1 text-xs"
                onClick={() => onAction(a)}
              >
                {iconForAction(a)}
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CompanyPreviewCard({
  parsed,
  disabled,
  creating,
  onConfirm,
  onCancel,
}: {
  parsed: ParsedCompany;
  disabled: boolean;
  creating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rows: Array<[string, string | undefined]> = [
    ["Name", parsed.name],
    ["GSTIN", parsed.gstin],
    ["PAN", parsed.pan],
    [
      "State",
      parsed.state
        ? `${parsed.state}${parsed.state_code ? ` (${parsed.state_code})` : ""}`
        : parsed.state_code,
    ],
    ["Phone", parsed.phone],
    ["Email", parsed.email],
    ["Address", parsed.address],
    ["FY start", parsed.financial_year_start],
    [
      "Inventory",
      parsed.inventory_enabled === undefined
        ? "Yes (default)"
        : parsed.inventory_enabled
          ? "Yes"
          : "No",
    ],
  ];
  const isGst =
    !!parsed.gstin &&
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(parsed.gstin);
  return (
    <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold">Company preview</span>
        <Badge
          variant={isGst ? "default" : "secondary"}
          className="ml-auto h-5 text-[10px]"
        >
          {isGst ? "GST Registered" : "Unregistered"}
        </Badge>
      </div>
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text
