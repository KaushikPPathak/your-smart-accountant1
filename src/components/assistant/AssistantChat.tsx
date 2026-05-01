import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Send, Sparkles, ArrowRight, Sun, Moon, Languages } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  matches?: KbEntry[];
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  text:
    "Hi! I'm **Mate**, your offline in-app guide. I can explain settings, walk you through features, take you to the right screen, or apply small changes for you.\n\nTry asking: *“how do I import from Tally?”*, *“switch to dark mode”*, or *“where is GSTR-3B?”*.",
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
  const [input, setInput] = useState("");
  const [activeCat, setActiveCat] = useState<KbEntry["category"] | "All">("All");
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { setLang } = useI18n();
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const browseEntries = useMemo(() => {
    if (activeCat === "All") return ASSISTANT_KB;
    return ASSISTANT_KB.filter((e) => e.category === activeCat);
  }, [activeCat]);

  function ask(rawText: string) {
    const text = rawText.trim();
    if (!text) return;
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
    };

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
    setMessages((m) => [...m, userMsg, reply]);
    setInput("");
  }

  function runAction(a: AssistantAction) {
    if (a.kind === "navigate" && a.to) {
      navigate({ to: a.to });
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
      {/* Chat column */}
      <Card className="flex h-[calc(100vh-12rem)] flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Mate — your in-app assistant</span>
            <span className="text-[11px] text-muted-foreground">
              Runs fully offline · knows the app's settings, screens & options
            </span>
          </div>
          <Badge variant="secondary" className="ml-auto gap-1">
            <Sparkles className="h-3 w-3" /> Offline
          </Badge>
        </div>

        <ScrollArea className="flex-1">
          <div ref={scrollerRef} className="flex flex-col gap-3 p-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} onAction={runAction} />
            ))}
          </div>
        </ScrollArea>

        {/* Suggestion chips */}
        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2 border-t border-border px-4 py-2">
            {SUGGESTIONS.map((s) => (
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

        <form
          className="flex gap-2 border-t border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about the software…"
            autoFocus
          />
          <Button type="submit" size="icon" aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </Card>

      {/* Browse topics column */}
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
}: {
  msg: ChatMessage;
  onAction: (a: AssistantAction) => void;
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

function iconForAction(a: AssistantAction) {
  if (a.kind === "set-theme")
    return a.theme === "dark" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />;
  if (a.kind === "set-language") return <Languages className="h-3 w-3" />;
  return <ArrowRight className="h-3 w-3" />;
}

/** Tiny markdown-ish renderer: **bold**, *italic*, line breaks, and bullet lists. */
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
  // escape HTML first
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
