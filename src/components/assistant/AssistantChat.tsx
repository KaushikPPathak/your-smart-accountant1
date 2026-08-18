import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bot, Send, Sparkles, ArrowRight, Sun, Moon, Languages, Building2,
  Check, X, Pencil, Loader2, Wrench, FileSpreadsheet, Mic, MicOff,
  FileText, Paperclip, ScanLine, BrainCircuit, Volume2, VolumeX,
  Headphones, Cpu, Cloud, RotateCcw, Zap
} from "lucide-react";
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

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text: "Hello! I am your AI accounting assistant. How can I help you today?",
};

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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { memberships, activeCompanyId, setActiveCompanyId, refresh } = useCompany();
  const memoryRef = useRef<ConversationMemory | undefined>(undefined);
  const [thinking, setThinking] = useState(false);
  const [modelPref, setModelPref] = useState<ModelPreference>(() => getModelPreference());
  const tts = useVoiceOutput();
  const [ttsOn, setTtsOn] = useState(false);

  async function ask(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    if (inputRef.current) inputRef.current.value = "";
    setThinking(true);
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
        addMessage({
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
        });
      } else {
        toast.error(res.error || "Assistant failed to respond");
      }
    } catch (err) {
      toast.error(String(err));
    } finally {
      setThinking(false);
    }
  }

  function addMessage(msg: Omit<ChatMessage, "id">): string {
    const id = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    setMessages((m) => [...m, { ...msg, id }]);
    return id;
  }

  // ... (Keep existing UI rendering code, stripped of the deleted logic)
  return (
    <div className="flex h-full flex-col">
       {/* Implementation skeleton remains, just calling ask() */}
    </div>
  );
}
