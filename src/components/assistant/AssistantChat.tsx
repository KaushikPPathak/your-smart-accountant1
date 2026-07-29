import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Send, Sparkles, ArrowRight, Sun, Moon, Languages, Building2, Check, X, Pencil, Loader2, Wrench, FileSpreadsheet, Mic, MicOff, FileText, Paperclip, ScanLine, BrainCircuit, Volume2, VolumeX, Headphones } from "lucide-react";
import { extractInvoiceOcr, type OcrDraft } from "@/lib/ai/ocr-invoice";
import { recallPartyPattern, rememberPartyPattern, type PartyPattern } from "@/lib/ai/persistent-memory";
import { Link } from "@tanstack/react-router";
import { useVoiceInput } from "@/lib/ai/voice-input";
import { useVoiceOutput } from "@/lib/ai/voice-output";
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
import type { StructuredCard } from "@/lib/ai/sqliteContext";
import type { ConversationMemory } from "@/lib/ai/conversation-memory";
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
import { detectVoucherAction } from "@/lib/ai/voucher-actions";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  matches?: KbEntry[];
  preview?: ParsedCompany;
  voucherPreview?: ParsedVoucher;
  toolCalls?: { name: string; input: string }[];
  card?: StructuredCard;
  ocrPreview?: OcrDraft;
  memoryHint?: PartyPattern;
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

type ParsedVoucher = {
  intent: VoucherIntent;
  date: string;
  amount: number;
  narration?: string;
  refNo?: string;
  partyLedgerId?: string;
  cashBankLedgerId?: string;
  counterLedgerId?: string;
  displayDetails?: {
    partyName?: string;
    accountName?: string;
  };
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
  const [pendingVoucher, setPendingVoucher] = useState<ParsedVoucher | null>(null);
  const [aiMode, setAiMode] = useState(true);
  const [thinking, setThinking] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [pendingOcr, setPendingOcr] = useState<OcrDraft | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Per-session conversation memory — last resolved party/company/asOn so
  // follow-ups like "and as on 31/12/2025?" work without repeating names.
  const memoryRef = useRef<ConversationMemory | undefined>(undefined);

  // Phase D — Voice + hands-free flow. Voice input uses the Web Speech
  // Recognition API; voice output uses SpeechSynthesis. Both are fully
  // in-browser (offline, free, private). When hands-free is on, the mic
  // auto-restarts after each spoken reply for a walkie-talkie loop.
  const [handsFree, setHandsFree] = useState(false);
  const [ttsOn, setTtsOn] = useState(false);
  const handsFreeRef = useRef(false);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);
  const tts = useVoiceOutput();
  const askRef = useRef<((t: string) => void) | null>(null);
  const voice = useVoiceInput((text) => {
    if (handsFreeRef.current) {
      askRef.current?.(text);
      return;
    }
    const el = inputRef.current;
    if (!el) return;
    const cur = el.value.trim();
    el.value = cur ? `${cur} ${text}` : text;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
    el.focus();
  });

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
            text: `I couldn't create the company: **${error?.message ?? "Unknown error"}**.\n\nYou can also open the full form with the button below Toggle Engine.`,
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

  function confirmPostVoucher(draft: ParsedVoucher) {
    writeAssistantPrefill({
      voucherType: draft.intent,
      date: draft.date,
      partyLedgerId: draft.partyLedgerId ?? undefined,
      cashBankLedgerId: draft.cashBankLedgerId ?? undefined,
      counterLedgerId: draft.counterLedgerId ?? undefined,
      amount: draft.amount,
      narration: draft.narration,
      refNo: draft.refNo,
    });
    
    setMessages((m) => [
      ...m,
      {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: `Opening the **${draft.intent}** workspace. Press **Enter** or use keyboard shortcuts (Ctrl+S) to commit to local system files safely.`,
      },
    ]);
    
    setPendingVoucher(null);
    navigate({ to: intentToRoute(draft.intent) });
  }

  // ---------- Phase 3: OCR bill → voucher draft --------------------------
  async function handleFileUpload(file: File, intent: "purchase" | "sales" = "purchase") {
    if (!activeCompanyId) {
      toast.error("Select or create a company first.");
      return;
    }
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isImage && !isPdf) {
      toast.error("Only images (JPG/PNG) and PDF files are supported.");
      return;
    }
    setMessages((m) => [
      ...m,
      {
        id: `u-${Date.now()}`,
        role: "user",
        text: `📎 Uploaded **${file.name}** — extracting invoice data…`,
      },
    ]);
    setOcrLoading(true);
    try {
      const draft = await extractInvoiceOcr(file, activeCompanyId, intent);
      const partyName = draft.matchedPartyName ?? draft.extracted.party_name;
      const memoryHint = partyName
        ? (await recallPartyPattern(activeCompanyId, partyName)) ?? undefined
        : undefined;
      setPendingOcr(draft);
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: memoryHint
            ? `I extracted the invoice. I also **remember** this party — see the note below. Confirm to open the ${intent} form.`
            : `I extracted the invoice. Review the details below and confirm to open the ${intent} form pre-filled.`,
          ocrPreview: draft,
          memoryHint,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`OCR failed: ${msg}`);
      setMessages((m) => [
        ...m,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: `I couldn't read that file — ${msg}. Try a clearer photo, or type the invoice details in chat.`,
        },
      ]);
    } finally {
      setOcrLoading(false);
    }
  }

  async function confirmOcrDraft(draft: OcrDraft, opts: { remember: boolean; overrideLedgerId?: string; overrideLedgerName?: string }) {
    const partyLedgerId = opts.overrideLedgerId ?? draft.matchedPartyLedgerId ?? undefined;
    const partyName = opts.overrideLedgerName ?? draft.matchedPartyName ?? draft.extracted.party_name;
    writeAssistantPrefill({
      voucherType: draft.intent,
      date: draft.extracted.invoice_date ?? new Date().toISOString().slice(0, 10),
      partyLedgerId,
      amount: draft.extracted.total_amount,
      narration: `${draft.intent === "purchase" ? "Bill" : "Invoice"} from ${draft.extracted.party_name}${draft.extracted.invoice_number ? ` — ${draft.extracted.invoice_number}` : ""}`,
      refNo: draft.extracted.invoice_number ?? undefined,
    });
    if (opts.remember && activeCompanyId && partyLedgerId && partyName) {
      await rememberPartyPattern(activeCompanyId, partyName, {
        counterLedgerId: partyLedgerId,
        counterLedgerName: partyName,
        intent: draft.intent,
      });
      toast.success(`Remembered: ${partyName} → ${draft.intent}`);
    }
    setPendingOcr(null);
    setMessages((m) => [
      ...m,
      {
        id: `a-${Date.now()}`,
        role: "assistant",
        text: `Opening the **${draft.intent}** form. Review the line items, HSN, and GST split before saving.`,
      },
    ]);
    navigate({ to: intentToRoute(draft.intent) });
  }


  function ask(rawText: string) {
    askRef.current = ask;
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

      // Phase 2 — local draft-first path. Handles reverse / duplicate and
      // fully-parseable "pay 12000 rent to landlord cash today" style
      // commands without calling the LLM.
      if (activeCompanyId) {
        try {
          const action = await detectVoucherAction(text, activeCompanyId);
          if (action) {
            const d = action.draft;
            const voucherPayload: ParsedVoucher = {
              intent: d.intent,
              date: d.date,
              amount: d.amount,
              narration: d.narration,
              refNo: d.refNo,
              partyLedgerId: d.partyLedgerId,
              cashBankLedgerId: d.cashBankLedgerId,
              counterLedgerId: d.counterLedgerId,
              displayDetails: d.displayDetails,
            };
            setPendingVoucher(voucherPayload);
            const header =
              action.kind === "reverse"
                ? `Reversing **${action.source.type}** voucher #${action.source.number} dated ${action.source.date}. Review and press **Enter** to open the compensating entry.`
                : action.kind === "duplicate"
                  ? `Duplicating ${action.source.type} voucher${action.source.number ? ` #${action.source.number}` : ""} from ${action.source.date} onto **${d.date}**. Review and press **Enter** to open.`
                  : `Drafted locally from your instruction — review the ledgers and press **Enter** to open the ${d.intent} form.`;
            setMessages((m) => [
              ...m,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: header,
                voucherPreview: voucherPayload,
              },
            ]);
            return;
          }
        } catch (err) {
          console.warn("[assistant.local-draft] failed", err);
        }
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
            
            // Resolve ledger names for descriptive preview architecture 
            const targetParty = ledgers.find(l => l.id === d.partyLedgerId)?.name || d.partyLedgerId;
            const targetAccount = ledgers.find(l => l.id === d.cashBankLedgerId || l.id === d.counterLedgerId)?.name;

            const voucherPayload: ParsedVoucher = {
              intent,
              date: d.date,
              amount: d.amount,
              narration: d.narration,
              refNo: d.refNo,
              partyLedgerId: d.partyLedgerId ?? undefined,
              cashBankLedgerId: d.cashBankLedgerId ?? undefined,
              counterLedgerId: d.counterLedgerId ?? undefined,
              displayDetails: {
                partyName: targetParty ?? undefined,
                accountName: targetAccount ?? undefined
              }
            };

            setPendingVoucher(voucherPayload);

            setMessages((m) => [
              ...m,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: `I've analyzed your intent and generated an accounting voucher preview. please review the ledger distribution balances before routing into the manual journal interface:`,
                voucherPreview: voucherPayload,
              },
            ]);
            setThinking(false);
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
            data: {
              companyId: activeCompanyId ?? null,
              messages: history,
              prior: memoryRef.current,
            },
          });
          if (res.memory) memoryRef.current = res.memory;
          if (res.ok && res.text) {
            setMessages((m) => [
              ...m,
              {
                id: `a-${Date.now()}`,
                role: "assistant",
                text: res.text,
                toolCalls: res.toolCalls,
                card: res.card,
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
      // Split path + query so TanStack Router can navigate client-side.
      // Using window.location.href here broke inside the Tauri desktop
      // shell (blank white screen) because the browser resolved the
      // relative URL against the file:// origin.
      const [path, qs] = a.to.split("?");
      const search: Record<string, string> = {};
      if (qs) {
        for (const [k, v] of new URLSearchParams(qs)) search[k] = v;
      }
      navigate({ to: path, search: search as never });
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
                onConfirmVoucher={confirmPostVoucher}
                onCancelVoucher={() => {
                  setPendingVoucher(null);
                  setMessages((mm) => [
                    ...mm,
                    {
                      id: `a-${Date.now()}`,
                      role: "assistant",
                      text: "Voucher posting canceled. Let me know if you need to adjust parameters or structure different operational entries.",
                    }
                  ]);
                }}
                creating={creating}
                isPendingCompany={!!pendingCompany && m.preview === pendingCompany}
                isPendingVoucher={!!pendingVoucher && m.voucherPreview === pendingVoucher}
                onConfirmOcr={confirmOcrDraft}
                onCancelOcr={() => {
                  setPendingOcr(null);
                  setMessages((mm) => [
                    ...mm,
                    { id: `a-${Date.now()}`, role: "assistant", text: "OCR draft discarded. Drop another bill anytime." },
                  ]);
                }}
                isPendingOcr={!!pendingOcr && m.ocrPreview === pendingOcr}
              />
            ))}
            {(thinking || ocrLoading) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {ocrLoading ? "Reading your invoice…" : "Mate is thinking…"}
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
          className={`flex items-end gap-2 border-t border-border p-3 transition-colors ${isDragging ? "bg-primary/5 ring-2 ring-primary/40 ring-inset" : ""}`}
          onSubmit={(e) => {
            e.preventDefault();
            ask(inputRef.current?.value ?? "");
          }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFileUpload(file, "purchase");
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileUpload(file, "purchase");
              e.target.value = "";
            }}
          />
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
                ? "Ask anything, or drop a bill/invoice here to auto-extract. Enter to send, Shift+Enter for new line."
                : "Type or paste: Name: ABC Traders\nGSTIN: 27ABCDE1234F1Z5\nPhone: 9876543210"
            }
            autoFocus
            disabled={creating || thinking || ocrLoading}
            className="min-h-[60px] max-h-[240px] resize-none text-sm"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Upload bill / invoice"
            title="Upload bill or invoice (image/PDF) — I'll extract party, GSTIN, HSN & tax"
            onClick={() => fileInputRef.current?.click()}
            disabled={creating || thinking || ocrLoading || !hasCompany}
          >
            {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          </Button>
          {voice.supported ? (
            <Button
              type="button"
              size="icon"
              variant={voice.listening ? "default" : "outline"}
              aria-label={voice.listening ? "Stop voice input" : "Start voice input"}
              title={voice.listening ? "Listening… click to stop" : "Speak your question"}
              onClick={() => (voice.listening ? voice.stop() : voice.start())}
              disabled={creating || thinking}
            >
              {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
          ) : null}
          <Button type="submit" size="icon" aria-label="Send" disabled={creating || thinking || ocrLoading}>
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

function formatInrCard(paise: number): string {
  const rupees = Math.abs(paise) / 100;
  return "₹" + new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rupees);
}

function BalanceCard({ card }: { card: StructuredCard }) {
  const drCr = card.isDebit ? "Dr" : "Cr";
  const closingClass = card.isDebit ? "text-emerald-600" : "text-rose-600";
  return (
    <div className="mb-2 rounded-md border border-border/60 bg-background/70 p-3 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold text-sm">{card.partyName || "—"}</div>
        <div className={`font-mono font-bold text-sm ${closingClass}`}>
          {formatInrCard(card.closingPaise)} {drCr}
        </div>
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {card.partyGroup ?? "Ledger"}
        {card.asOnDate ? ` · as on ${card.asOnDate}` : ""}
        {card.companyName ? ` · ${card.companyName}` : ""}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-muted-foreground">Opening</div>
          <div className="font-mono">{formatInrCard(card.openingPaise)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Debits</div>
          <div className="font-mono text-emerald-600">{formatInrCard(card.debitPaise)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Credits</div>
          <div className="font-mono text-rose-600">{formatInrCard(card.creditPaise)}</div>
        </div>
      </div>
      {card.modeSplit ? (
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] border-t border-border/40 pt-2">
          <div>
            <div className="text-muted-foreground">Cash</div>
            <div className="font-mono">{formatInrCard(card.modeSplit.cashPaise)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Bank</div>
            <div className="font-mono">{formatInrCard(card.modeSplit.bankPaise)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Other</div>
            <div className="font-mono">{formatInrCard(card.modeSplit.otherPaise)}</div>
          </div>
        </div>
      ) : null}
      {card.recentVouchers && card.recentVouchers.length > 0 ? (
        <div className="mt-2 border-t border-border/40 pt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Recent vouchers — click to open
          </div>
          <div className="space-y-0.5">
            {card.recentVouchers.slice(0, 6).map((v) => (
              <Link
                key={v.id}
                to="/app/vouchers/$voucherId"
                params={{ voucherId: v.id }}
                className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="font-mono">{v.number || "—"}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{v.date}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="uppercase text-[10px] text-muted-foreground">{v.kind}</span>
                </span>
                <span className="font-mono shrink-0">{formatInrCard(v.totalPaise)}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-2 text-[10px] text-muted-foreground">
        Verified from your books · {card.voucherCount} voucher{card.voucherCount === 1 ? "" : "s"}
      </div>

    </div>
  );
}


function MessageBubble({
  msg,
  onAction,
  onConfirmCompany,
  onCancelCompany,
  onConfirmVoucher,
  onCancelVoucher,
  creating,
  isPendingCompany,
  isPendingVoucher,
  onConfirmOcr,
  onCancelOcr,
  isPendingOcr,
}: {
  msg: ChatMessage;
  onAction: (a: AssistantAction) => void;
  onConfirmCompany: (p: ParsedCompany) => void;
  onCancelCompany: () => void;
  onConfirmVoucher: (d: ParsedVoucher) => void;
  onCancelVoucher: () => void;
  creating: boolean;
  isPendingCompany: boolean;
  isPendingVoucher: boolean;
  onConfirmOcr: (d: OcrDraft, opts: { remember: boolean; overrideLedgerId?: string; overrideLedgerName?: string }) => void;
  onCancelOcr: () => void;
  isPendingOcr: boolean;
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
        {!isUser && msg.card ? <BalanceCard card={msg.card} /> : null}
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
            disabled={!isPendingCompany || creating}
            creating={creating}
            onConfirm={() => onConfirmCompany(msg.preview!)}
            onCancel={onCancelCompany}
          />
        )}

        {!isUser && msg.voucherPreview && (
          <VoucherPreviewCard
            draft={msg.voucherPreview}
            disabled={!isPendingVoucher}
            onConfirm={() => onConfirmVoucher(msg.voucherPreview!)}
            onCancel={onCancelVoucher}
          />
        )}

        {!isUser && msg.ocrPreview && (
          <OcrPreviewCard
            draft={msg.ocrPreview}
            memoryHint={msg.memoryHint}
            disabled={!isPendingOcr}
            onConfirm={(opts) => onConfirmOcr(msg.ocrPreview!, opts)}
            onCancel={onCancelOcr}
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

function VoucherPreviewCard({
  draft,
  disabled,
  onConfirm,
  onCancel,
}: {
  draft: ParsedVoucher;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const formattedAmount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(draft.amount);

  const rows: Array<[string, string | undefined]> = [
    ["Voucher Type", draft.intent.toUpperCase()],
    ["Date", draft.date],
    ["Amount", formattedAmount],
    ["Debit/Party Account", draft.displayDetails?.partyName || "Unassigned / Auto-resolve"],
    ["Credit/Bank Account", draft.displayDetails?.accountName || "Unassigned / Auto-resolve"],
    ["Narration", draft.narration],
    ["Ref / Invoice No", draft.refNo],
  ];

  return (
    <div className="mt-3 rounded-lg border border-border bg-background/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Transaction Draft Preview</span>
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words font-medium">
              {v ? v : <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        ))}
      </dl>
      {!disabled ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          This transaction draft has been sent to the accounting ledger modules.
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-7 gap-1 text-xs bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={onConfirm}
          >
            <Check className="h-3 w-3" /> Confirm & Open Form
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={onCancel}
          >
            <X className="h-3 w-3" /> Drop Draft
          </Button>
        </div>
      )}
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
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-words font-medium">
              {v ? v : <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        ))}
      </dl>
      {disabled ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {creating ? "Creating company…" : "This preview has been actioned."}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onConfirm}
            disabled={creating || !parsed.name}
          >
            <Check className="h-3 w-3" /> Confirm & create
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={onCancel}
            disabled={creating}
          >
            <X className="h-3 w-3" /> Cancel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.href = "/app/companies?new=1";
              }
            }}
            disabled={creating}
          >
            <Pencil className="h-3 w-3" /> Edit in full form
          </Button>
        </div>
      )}
    </div>
  );
}

function iconForAction(a: AssistantAction) {
  if (a.kind === "set-theme")
    return a.theme === "dark" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />;
  if (a.kind === "set-language") return <Languages className="h-3 w-3" />;
  return <ArrowRight className="h-3 w-3" />;
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.trim().startsWith("- ")) {
          return (
            <div key={i} className="ml-3 flex gap-1.5">
              <span aria-hidden>•</span>
              <span dangerouslySetInnerHTML={{ __html: inlineMd(line.replace(/^- /, "")) }} />
            </div>
          );
        }
        if (line.trim() === "") return <div key={i} className="h-1" />;
        return <div key={i} dangerouslySetInnerHTML={{ __html: inlineMd(line) }} />;
      })}
    </div>
  );
}

function inlineMd(s: string): string {
  const esc = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, '<code class="rounded bg-background/60 px-1 text-[11px]">$1</code>');
}

// ---------- Phase 3: OCR preview card ---------------------------------------
function OcrPreviewCard({
  draft,
  memoryHint,
  disabled,
  onConfirm,
  onCancel,
}: {
  draft: OcrDraft;
  memoryHint?: PartyPattern;
  disabled: boolean;
  onConfirm: (opts: { remember: boolean; overrideLedgerId?: string; overrideLedgerName?: string }) => void;
  onCancel: () => void;
}) {
  const [remember, setRemember] = useState(false);
  const [overrideId, setOverrideId] = useState<string | undefined>(undefined);
  const [overrideName, setOverrideName] = useState<string | undefined>(undefined);
  const e = draft.extracted;
  const conf = Math.round((e.confidence ?? 0) * 100);
  const confTone =
    conf >= 80 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" :
    conf >= 60 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
                 "bg-rose-500/15 text-rose-700 dark:text-rose-300";
  const matched = !!draft.matchedPartyLedgerId;

  return (
    <div className="mt-3 rounded-lg border bg-background/60 p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <ScanLine className="h-3.5 w-3.5 text-primary" />
        <div className="font-semibold">Extracted invoice</div>
        <Badge className={`ml-auto gap-1 border-0 ${confTone}`}>{conf}% confidence</Badge>
      </div>

      {memoryHint && (
        <div className="mb-2 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
          <BrainCircuit className="mt-0.5 h-3.5 w-3.5 text-primary" />
          <div className="space-y-0.5">
            <div className="font-medium text-primary">I remember this party</div>
            <div className="text-[11px] text-muted-foreground">
              You booked <b>{memoryHint.displayName}</b> under <b>{memoryHint.counterLedgerName ?? "—"}</b>
              {memoryHint.rcmPercent ? ` with ${memoryHint.rcmPercent}% RCM` : ""} · seen {memoryHint.hits}×.
              {memoryHint.note ? ` Note: ${memoryHint.note}` : ""}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div><span className="text-muted-foreground">Party:</span> <b>{e.party_name || "—"}</b></div>
        <div><span className="text-muted-foreground">GSTIN:</span> {e.party_gstin || "—"}</div>
        <div><span className="text-muted-foreground">Invoice #:</span> {e.invoice_number || "—"}</div>
        <div><span className="text-muted-foreground">Date:</span> {e.invoice_date || "—"}</div>
        <div><span className="text-muted-foreground">Taxable:</span> ₹ {e.taxable_value?.toLocaleString("en-IN")}</div>
        <div><span className="text-muted-foreground">GST:</span> ₹ {((e.cgst||0)+(e.sgst||0)+(e.igst||0)).toLocaleString("en-IN")} {e.is_interstate ? "(IGST)" : "(CGST+SGST)"}</div>
        <div className="col-span-2 border-t pt-1"><span className="text-muted-foreground">Total:</span> <b>₹ {e.total_amount?.toLocaleString("en-IN")}</b></div>
      </div>

      {e.items && e.items.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] font-medium text-muted-foreground">Line items ({e.items.length})</div>
          <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border bg-muted/30 p-1.5">
            {e.items.slice(0, 8).map((it, i) => (
              <div key={i} className="flex items-center gap-2 text-[11px]">
                <span className="flex-1 truncate">{it.description}</span>
                {it.hsn && <span className="text-muted-foreground">{it.hsn}</span>}
                {typeof it.gst_rate === "number" && <span className="text-muted-foreground">{it.gst_rate}%</span>}
                <span className="tabular-nums">₹ {it.amount?.toLocaleString("en-IN")}</span>
              </div>
            ))}
            {e.items.length > 8 && <div className="text-[10px] text-muted-foreground">…and {e.items.length - 8} more</div>}
          </div>
        </div>
      )}

      <div className="mt-2 rounded-md border p-2">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">Party ledger</div>
        {matched ? (
          <div className="flex items-center gap-2">
            <Check className="h-3 w-3 text-emerald-600" />
            <span>Matched → <b>{draft.matchedPartyName}</b></span>
            <Badge variant="outline" className="ml-auto text-[10px]">{Math.round(draft.matchScore * 100)}%</Badge>
          </div>
        ) : draft.alternatives.length > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
              <span>No confident match. Pick one:</span>
            </div>
            {draft.alternatives.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => { setOverrideId(a.id); setOverrideName(a.name); }}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted ${overrideId === a.id ? "bg-primary/10 ring-1 ring-primary" : ""}`}
              >
                <span className="flex-1 truncate">{a.name}</span>
                <span className="text-[10px] text-muted-foreground">{Math.round(a.score * 100)}%</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">No local ledger match — one will be created in the form.</div>
        )}
      </div>

      {(matched || overrideId) && (
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(ev) => setRemember(ev.target.checked)}
            className="h-3 w-3"
          />
          Remember this party for future bills
        </label>
      )}

      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          className="h-7 gap-1 text-xs"
          disabled={disabled}
          onClick={() => onConfirm({ remember, overrideLedgerId: overrideId, overrideLedgerName: overrideName })}
        >
          <Check className="h-3 w-3" /> Open {draft.intent} form
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" disabled={disabled} onClick={onCancel}>
          <X className="h-3 w-3" /> Discard
        </Button>
      </div>
    </div>
  );
}
