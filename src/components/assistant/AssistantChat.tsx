import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot, Send, Sparkles, ArrowRight, Sun, Moon, Languages, Building2,
  Check, X, Pencil, Loader2, Wrench, FileSpreadsheet, Mic, MicOff,
  FileText, Paperclip, ScanLine, Volume2, VolumeX,
  Headphones, Cpu, Cloud, RotateCcw, Zap, History, MessageSquare, Trash2
} from "lucide-react";
import { ChatHeader, ChatFooterMetadata } from "./ChatUI";
import { extractInvoiceOcr, type OcrDraft, type OcrExtracted } from "@/lib/ai/ocr-invoice";
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
import {
  ASSISTANT_KB,
  KB_CATEGORIES,
  type AssistantAction,
  type KbEntry,
} from "@/lib/assistant-knowledge";
import { assistantChat, type ParsedCompany, type ParsedVoucher } from "@/lib/assistant.functions";
import type { StructuredCard } from "@/lib/ai/sqliteContext";
import type { ConversationMemory } from "@/lib/ai/conversation-memory";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useCompany } from "@/lib/company-context";
import {
  executeVoucherAction,
  undoLastVoucher,
  type VoucherAction,
  type VoucherExecutionResult,
} from "@/lib/ai/voucher-actions";
import { StreamingText } from "@/components/assistant/StreamingText";
import { AnswerProvenance } from "@/components/assistant/AnswerProvenance";
import {
  getModelPreference, setModelPreference, modelPreferenceLabel,
  type ModelPreference,
} from "@/lib/ai/model-preference";
import { isWebGpuAvailable } from "@/lib/ai/webllm";
import { clearSpeculation } from "@/lib/ai/prefetch";
import { VoucherPreviewCard, OcrPreviewCard } from "./VoucherPreviewCards";
import { cn } from "@/lib/utils";

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Hello! I am **Mehtaji**, your AI accounting assistant. How can I help you today?",
};

const SUGGESTIONS = [
  "How do I create a sales invoice?",
  "Import from Tally / Busy",
  "Switch to dark mode",
  "Where is GSTR-3B?",
  "Backup my company",
  "Invite a team member",
];

export type AiActionKind = "chat" | "voucher" | "report" | "command" | "voucher_executed";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  matches?: KbEntry[];
  preview?: ParsedCompany;
  voucherPreview?: ParsedVoucher;
  voucherAction?: VoucherAction;
  voucherResult?: VoucherExecutionResult;
  toolCalls?: { name: string; input: string }[];
  card?: StructuredCard;
  ocrPreview?: OcrDraft;
  memoryHint?: PartyPattern;
  question?: string;
  latencyMs?: number;
}

export function AssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeCat, setActiveCat] = useState<KbEntry["category"] | "All">("All");
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { setLang } = useI18n();
  const { user } = useAuth();
  const { memberships, activeCompanyId, setActiveCompanyId, refresh } = useCompany();
  
  const [thinking, setThinking] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [pendingOcr, setPendingOcr] = useState<OcrDraft | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const memoryRef = useRef<ConversationMemory | undefined>(undefined);
  const [modelPref, setModelPref] = useState<ModelPreference>(() => getModelPreference());
  const [ttsOn, setTtsOn] = useState(false);
  
  const tts = useVoiceOutput();
  const voice = useVoiceInput((text) => {
    const el = inputRef.current;
    if (!el) return;
    const cur = el.value.trim();
    el.value = cur ? `${cur} ${text}` : text;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
    el.focus();
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  function addMessage(msg: Omit<ChatMessage, "id">): string {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    setMessages((m) => [...m, { ...msg, id }]);
    return id;
  }

  async function ask(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = "auto";
    }
    
    setThinking(true);
    setPendingOcr(null);
    
    try {
      const res = await assistantChat({
        data: {
          companyId: activeCompanyId,
          messages: messages.concat([userMsg]).map(m => ({ role: m.role, content: m.text })),
          prior: memoryRef.current,
          userId: user?.id
        }
      });
      
      if (res.ok) {
        if (res.memory) memoryRef.current = res.memory;
        
        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: res.text,
          matches: res.matches,
          card: res.card,
          toolCalls: res.toolCalls,
          latencyMs: res.latencyMs,
          voucherPreview: res.pendingVoucher,
          voucherAction: res.voucherAction,
          voucherResult: res.voucherResult,
          preview: res.pendingCompany
        };
        
        setMessages(prev => [...prev, assistantMsg]);
        
        if (ttsOn && res.text) {
          tts.speak(res.text.replace(/\[[VLF]:[^\]]+\]/g, ""));
        }
      } else {
        toast.error(res.error || "Mehtaji failed to respond");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setThinking(false);
    }
  }

  const handleAction = async (action: AssistantAction) => {
    if (action.kind === "navigate" && action.to) {
      navigate({ to: action.to as any });
    } else if (action.kind === "set-theme" && action.theme) {
      setTheme(action.theme);
      addMessage({ role: "assistant", text: `Switched to ${action.theme} mode.` });
    } else if (action.kind === "set-language" && action.lang) {
      setLang(action.lang as LangCode);
      addMessage({ role: "assistant", text: `Interface language updated.` });
    }
  };

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeCompanyId) return;
    setOcrLoading(true);
    try {
      const draft = await extractInvoiceOcr(file, activeCompanyId);
      setPendingOcr(draft);
      addMessage({
        role: "user",
        text: `Attached: ${file.name}`,
        ocrPreview: draft
      });
      // Automatically prompt the assistant about the OCR draft
      ask(`I have attached an invoice from ${draft.extracted.party_name || 'a party'} for ₹${draft.extracted.total_amount}. Please draft a voucher.`);
    } catch (err) {
      toast.error("Failed to read invoice");
    } finally {
      setOcrLoading(false);
    }
  };

  const confirmVoucher = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.voucherAction || !activeCompanyId) return;
    
    try {
      const res = await executeVoucherAction(msg.voucherAction, activeCompanyId);
      setMessages(prev => prev.map(m => 
        m.id === msgId ? { ...m, voucherResult: res, voucherPreview: undefined } : m
      ));
      toast.success("Voucher posted successfully");
    } catch (err) {
      toast.error(String(err));
    }
  };

  const undoVoucher = async (msgId: string) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg?.voucherResult?.voucher?.id || !activeCompanyId) return;
    
    try {
      const { undoLastVoucher } = await import("@/lib/ai/voucher-actions");
      await undoLastVoucher();
      setMessages(prev => prev.map(m => 
        m.id === msgId ? { ...m, voucherResult: undefined, text: msg.text + "\n\n*(Transaction Undone)*" } : m
      ));
      toast.success("Transaction undone");
    } catch (err) {
      toast.error("Failed to undo");
    }
  };

  const filteredKb = useMemo(() => {
    if (activeCat === "All") return ASSISTANT_KB;
    return ASSISTANT_KB.filter(e => e.category === activeCat);
  }, [activeCat]);

  return (
    <div 
      className={cn(
        "flex h-full flex-col bg-background/50 backdrop-blur-sm transition-all duration-300",
        isDragging && "bg-primary/5 ring-2 ring-primary ring-inset"
      )}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) {
          const input = fileInputRef.current;
          if (input) {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            onFileSelect({ target: input } as any);
          }
        }
      }}
    >
      {/* Header */}
      <ChatHeader 
        ttsOn={ttsOn}
        onToggleTts={() => setTtsOn(!ttsOn)}
        modelPref={modelPref}
        onClearChat={() => setMessages([WELCOME])}
      />

      {/* Messages */}
      <ScrollArea ref={scrollerRef} className="flex-1 px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-6">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col gap-2",
                msg.role === "user" ? "items-end" : "items-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm transition-all",
                  msg.role === "user" 
                    ? "bg-primary text-primary-foreground rounded-tr-none" 
                    : "bg-card border text-card-foreground rounded-tl-none"
                )}
              >
                {msg.role === "assistant" ? (
                  <StreamingText 
                    text={msg.text} 
                    render={(shown: string) => <div className="whitespace-pre-wrap">{shown}</div>} 
                  />
                ) : (
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                )}
                
                {msg.latencyMs && (
                  <div className="mt-1 text-[9px] opacity-50">
                    Processed locally in {msg.latencyMs}ms
                  </div>
                )}
              </div>

              {/* Special Cards & Previews */}
              {msg.role === "assistant" && (
                <div className="flex w-full flex-col gap-3">
                  {msg.card && (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                      <AnswerProvenance 
                        answer={msg.text} 
                        question={msg.question || ""} 
                        toolNames={msg.toolCalls?.map(tc => tc.name)} 
                      />
                    </div>
                  )}

                  {msg.voucherPreview && (
                    <VoucherPreviewCard
                      draft={msg.voucherPreview as any}
                      action={msg.voucherAction}
                      disabled={!!msg.voucherResult}
                      onConfirm={() => confirmVoucher(msg.id)}
                      onEdit={() => {
                        const route = msg.voucherPreview?.intent ? `/app/vouchers/new/${msg.voucherPreview.intent.toLowerCase()}` : '/app/vouchers/new/journal';
                        navigate({ 
                          to: route as any,
                          // @ts-ignore - prefill is handled by consumeAssistantPrefill via writeAssistantPrefill which was called in assistantChat
                        });
                      }}
                      onCancel={() => setMessages(m => m.filter(x => x.id !== msg.id))}
                    />
                  )}

                  {msg.voucherResult && (
                    <Card className="border-emerald-500/20 bg-emerald-500/5">
                      <CardContent className="flex items-center justify-between p-3 text-xs">
                        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                          <Check className="h-4 w-4" />
                          <span>Voucher #{msg.voucherResult.voucher?.voucher_number} posted</span>
                        </div>
                        <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => undoVoucher(msg.id)}>
                          <RotateCcw className="mr-1 h-3 w-3" /> Undo
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {msg.preview && (
                    <Card className="border-primary/20 bg-primary/5">
                      <CardContent className="p-3">
                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                          <Building2 className="h-4 w-4" />
                          New Company Profile
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                          <span className="text-muted-foreground">Name:</span>
                          <span className="font-medium">{msg.preview.name}</span>
                          <span className="text-muted-foreground">GSTIN:</span>
                          <span className="font-medium">{msg.preview.gstin || "None"}</span>
                          <span className="text-muted-foreground">State:</span>
                          <span className="font-medium">{msg.preview.state || "Auto"}</span>
                        </div>
                        <Button 
                          className="mt-3 w-full gap-2" 
                          size="sm" 
                          onClick={() => navigate({ to: "/app/companies" })}
                        >
                          Review & Create Company <ArrowRight className="h-3 w-3" />
                        </Button>
                      </CardContent>
                    </Card>
                  )}

                  {msg.matches && msg.matches.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {msg.matches[0].actions?.map((action, i) => (
                        <Button
                          key={i}
                          variant="secondary"
                          size="sm"
                          className="h-7 rounded-full text-[11px]"
                          onClick={() => handleAction(action)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {thinking && (
            <div className="flex items-start gap-3 animate-in fade-in duration-300">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary animate-pulse">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-1.5 rounded-2xl bg-card border px-4 py-2.5 text-sm shadow-sm">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:-0.3s]"></span>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40 [animation-delay:-0.15s]"></span>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/40"></span>
                <span className="ml-2 text-[11px] font-medium text-muted-foreground">Mehtaji is thinking...</span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer Area */}
      <div className="border-t bg-background/80 p-4 backdrop-blur-md">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* KB Browse / Suggestions */}
          {messages.length < 3 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input Area */}
          <div className="relative">
            <Textarea
              ref={inputRef}
              placeholder="Ask Mehtaji... (e.g., 'What is the balance of ABC Corp?')"
              className="min-h-[52px] w-full resize-none rounded-2xl border-2 border-muted-foreground/10 bg-card pr-24 transition-all focus:border-primary focus:ring-0"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask(inputRef.current?.value || "");
                }
              }}
              rows={1}
            />
            
            <div className="absolute bottom-2 right-2 flex items-center gap-1">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="application/pdf,image/*"
                onChange={onFileSelect}
              />
              
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                onClick={() => fileInputRef.current?.click()}
                title="Attach Invoice (OCR)"
              >
                {ocrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 transition-colors",
                  voice.listening ? "text-destructive animate-pulse" : "text-muted-foreground hover:text-primary"
                )}
                onClick={() => voice.listening ? voice.stop() : voice.start()}
                title="Voice Input"
              >
                {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              
              <Button
                size="icon"
                className="h-8 w-8 rounded-xl shadow-lg shadow-primary/20"
                onClick={() => ask(inputRef.current?.value || "")}
                disabled={thinking}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
          
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3 text-amber-500" />
                Local Compute Only
              </span>
              <span className="flex items-center gap-1">
                <Check className="h-3 w-3 text-emerald-500" />
                Zero Data Tracking
              </span>
            </div>
            
            <button 
              className="hover:text-primary underline-offset-2 hover:underline"
              onClick={() => setActiveCat(activeCat === "All" ? "Vouchers" : "All")}
            >
              {activeCat === "All" ? "Browse Knowledge Base" : "Back to Chat"}
            </button>
          </div>
        </div>
      </div>
      
      {/* KB Overlay (simplified) */}
      {activeCat !== "All" && (
        <div className="absolute inset-x-0 top-14 bottom-0 z-10 bg-background px-4 py-4 animate-in slide-in-from-bottom-5 duration-300">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-bold">Knowledge Base</h3>
              <Button variant="ghost" size="sm" onClick={() => setActiveCat("All")}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="mb-6 flex flex-wrap gap-2">
              {KB_CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setActiveCat(c)}
                  className={cn(
                    "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                    activeCat === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            
            <ScrollArea className="h-[calc(100vh-320px)]">
              <div className="grid gap-3 pr-4">
                {filteredKb.map(entry => (
                  <Card key={entry.id} className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary/5" onClick={() => {
                    setActiveCat("All");
                    addMessage({ role: "assistant", text: entry.answer, matches: [entry] });
                  }}>
                    <CardContent className="p-4">
                      <div className="mb-1 text-sm font-semibold">{entry.title}</div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{entry.answer}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
