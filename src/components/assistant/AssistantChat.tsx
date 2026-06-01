import React, { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useServerFn } from "@tanstack/react-router";
import { 
  Send, 
  Bot, 
  User, 
  Loader2, 
  RefreshCw, 
  FileText, 
  PlusCircle, 
  Building2, 
  CheckCircle2, 
  AlertCircle 
} from "lucide-react";
import { assistantChat, assistantDraftVoucher } from "../server/assistantActions"; // Adjust path to your actual server actions file

// --- Types & Interfaces ---
interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  intent?: {
    type: "create_company" | "create_voucher" | "general";
    data?: any;
  };
}

interface CompanyPreview {
  name: string;
  gstin?: string;
  state?: string;
  pan?: string;
}

interface VoucherPreview {
  type: string;
  date: string;
  partyName: string;
  amount: number;
  items?: Array<{ description: string; amount: number; gstRate?: number }>;
}

const SUGGESTIONS = [
  "Create a new company named SHC Global Trade",
  "Draft a sales voucher for 10,000 INR with 18% GST",
  "Show my GST Input-Output credit balance",
  "Open the create-company form"
];

// --- Sub-Components ---

const RichText: React.FC<{ content: string }> = ({ content }) => {
  // Simple paragraph and bold line break parser for chat text
  return (
    <div className="space-y-1.5 text-sm leading-relaxed whitespace-pre-line">
      {content}
    </div>
  );
};

const CompanyPreviewCard: React.FC<{ data: CompanyPreview; onConfirm: () => void }> = ({ data, onConfirm }) => (
  <div className="mt-3 p-4 bg-slate-800/60 border border-slate-700 rounded-xl shadow-sm max-w-md">
    <div className="flex items-center gap-2 mb-3 text-emerald-400 font-medium text-sm">
      <Building2 size={16} />
      <span>Detected Company Details</span>
    </div>
    <div className="space-y-1.5 text-xs text-slate-300 mb-4">
      <p><strong className="text-slate-400">Name:</strong> {data.name}</p>
      {data.gstin && <p><strong className="text-slate-400">GSTIN:</strong> {data.gstin}</p>}
      {data.state && <p><strong className="text-slate-400">State:</strong> {data.state}</p>}
    </div>
    <button 
      onClick={onConfirm}
      className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-3 rounded-lg text-xs font-medium transition-colors"
    >
      <PlusCircle size={14} />
      Populate Company Form
    </button>
  </div>
);

const VoucherPreviewCard: React.FC<{ data: VoucherPreview; onConfirm: () => void }> = ({ data, onConfirm }) => (
  <div className="mt-3 p-4 bg-slate-800/60 border border-slate-700 rounded-xl shadow-sm max-w-md">
    <div className="flex items-center gap-2 mb-3 text-blue-400 font-medium text-sm">
      <FileText size={16} />
      <span>Draft Voucher Ready</span>
    </div>
    <div className="space-y-1.5 text-xs text-slate-300 mb-4">
      <p><strong className="text-slate-400">Type:</strong> <span className="uppercase">{data.type}</span></p>
      <p><strong className="text-slate-400">Party:</strong> {data.partyName}</p>
      <p><strong className="text-slate-400">Date:</strong> {data.date}</p>
      <p><strong className="text-slate-400">Total Amount:</strong> ₹{data.amount.toLocaleString('en-IN')}</p>
    </div>
    <button 
      onClick={onConfirm}
      className="w-full flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white py-2 px-3 rounded-lg text-xs font-medium transition-colors"
    >
      <CheckCircle2 size={14} />
      Review & Post Voucher
    </button>
  </div>
);

const MessageBubble: React.FC<{ 
  message: Message; 
  onActionConfirm: (type: string, data: any) => void 
}> = ({ message, onActionConfirm }) => {
  const isAssistant = message.role === "assistant";

  return (
    <div className={`flex gap-3 ${isAssistant ? "justify-start" : "justify-end"} mb-4`}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-500/30">
          <Bot size={16} />
        </div>
      )}
      
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${
        isAssistant 
          ? "bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-none" 
          : "bg-indigo-600 text-white rounded-tr-none"
      }`}>
        <RichText content={message.content} />
        
        {/* Render contextual payload UI if available */}
        {isAssistant && message.intent?.type === "create_company" && message.intent.data && (
          <CompanyPreviewCard 
            data={message.intent.data} 
            onConfirm={() => onActionConfirm("create_company", message.intent?.data)} 
          />
        )}

        {isAssistant && message.intent?.type === "create_voucher" && message.intent.data && (
          <VoucherPreviewCard 
            data={message.intent.data} 
            onConfirm={() => onActionConfirm("create_voucher", message.intent?.data)} 
          />
        )}

        <span className={`block text-[10px] mt-1.5 text-right ${isAssistant ? "text-slate-500" : "text-indigo-200"}`}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {!isAssistant && (
        <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
          <User size={16} />
        </div>
      )}
    </div>
  );
};

// --- Main Component ---
export default function AssistantChat() {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // TanStack Server Functions
  const callAssistant = useServerFn(assistantChat);
  const callDraftVoucher = useServerFn(assistantDraftVoucher);

  // Local State
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hello! I am your AI accounting assistant. I can help you register companies, draft GST-compliant vouchers, or check your input credit matrices. What would you like to do today?",
      timestamp: new Date()
    }
  ]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Handle Action Button Clicks from inside AI cards
  const handleActionConfirm = (type: string, data: any) => {
    if (type === "create_company") {
      // Pass extracted state down to the company creation route state
      navigate({
        to: "/companies/new",
        search: {
          name: data.name,
          gstin: data.gstin || "",
          state: data.state || ""
        }
      });
    } else if (type === "create_voucher") {
      navigate({
        to: "/vouchers/new",
        search: {
          type: data.type,
          party: data.partyName,
          amount: data.amount,
          date: data.date
        }
      });
    }
  };

  // Process prompt submit
  const handleSubmit = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: textToSend,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Trigger TanStack Server Function
      const response = await callAssistant({ 
        message: textToSend,
        history: messages.map(m => ({ role: m.role, content: m.content }))
      });

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.reply,
        timestamp: new Date(),
        intent: response.intent // Expecting { type: 'create_company' | 'create_voucher', data: ... }
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Failed to fetch AI response:", error);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "Sorry, I ran into an issue parsing that request. Please try again or rephrase your intent.",
        timestamp: new Date()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] max-w-4xl mx-auto bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
            <Bot size={20} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">AI Ledger Assistant</h2>
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Online & Ready
            </p>
          </div>
        </div>
        <button 
          onClick={() => setMessages([messages[0]])}
          className="p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          title="Reset Chat"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Chat History Viewport */}
      <div className="flex-1 overflow-y-auto p-6 bg-slate-950/40 space-y-4">
        {messages.map((msg) => (
          <MessageBubble 
            key={msg.id} 
            message={msg} 
            onActionConfirm={handleActionConfirm} 
          />
        ))}
        
        {isLoading && (
          <div className="flex gap-3 justify-start items-center text-slate-400 text-xs">
            <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
              <Loader2 size={14} className="animate-spin text-indigo-400" />
            </div>
            <span>Assistant is thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer Interface & Inputs */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-4">
        {/* Suggestion Chips */}
        {messages.length === 1 && !isLoading && (
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => handleSubmit(suggestion)}
                className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700/60 text-slate-300 px-3 py-1.5 rounded-full transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {/* Action input form */}
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit(input);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask to create a voucher, register business entities..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white p-2.5 rounded-xl transition-colors shrink-0 flex items-center justify-center"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
