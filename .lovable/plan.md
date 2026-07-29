# AI Assistant Human-ness Roadmap

Scope is huge (11 initiatives). Shipping in one turn would produce a mess. Below is a phased build plan grouped by dependency and ROI. Each phase is independently shippable and testable.

---

## Phase A — Foundations (ship first, everything else depends on these)

**A1. Persistent memory layer** (item 2, 11)
- New Dexie tables: `ai_user_prefs`, `ai_company_profile`, `ai_correction_log`.
- `src/lib/ai/memory.ts` — read/write helpers, snapshot into system prompt.
- Auto-capture: language preference, rounding style, recurring narrations, common HSN, favourite parties (frequency-ranked).
- Correction hook: when a user edits an AI-drafted voucher → diff logged → next prompt gets "user tends to X".

**A2. Trust & confidence layer** (item 8)
- Extend AI response envelope with `{value, confidence: 'green'|'amber'|'red', source: 'aggregator'|'llm+verified'|'llm'}`.
- Every deterministic retriever tags green; LLM-only tags red.
- `ConfidenceBadge.tsx` + "Show your work" drawer showing tool trace already captured in `error-ring`.

**A3. Domain style guide** (item 7)
- Update system prompt in `sqliteContext.ts`: Indian numbering (lakh/crore), Dr/Cr, "as on", §-section format, preserve Gujarati/Hindi party names verbatim.
- Add a formatter `formatIndianCurrency(paise)` used by all facts before injection.

---

## Phase B — Proactive intelligence (item 1, 3)

**B1. Morning briefing**
- `src/lib/ai/briefing.ts` — computes on app open (throttled once/day per company):
  invoices due today, GST payable this week, credit-limit breaches, negative stock.
- `MorningBriefingCard.tsx` mounted in dashboard.

**B2. Silent anomaly watchers**
- `src/lib/ai/watchers/` — pure functions run after each voucher save:
  duplicate voucher no., missing GSTIN on registered-party purchase, sales rate deviation >40%, negative stock, 44AD cash-receipt threshold.
- Emit toast + append to a "Notices" tray.

**B3. Deadline radar**
- Rules table (GSTR-1/3B, TDS, advance tax, MSME 45-day, ROC) computed from company registration data; surfaces in briefing.

**B4. Multi-step plan-then-execute**
- `src/lib/ai/planner.ts` — router upgrade: if question is compound ("why did X jump vs Y"), model returns a JSON plan; runner executes each retriever; results feed narration pass.
- Bounded to max 5 steps to avoid runaway.

---

## Phase C — Write actions with guardrails (item 5)

**C1. Draft-voucher tool**
- New tool `draft_voucher({type, date, party, amount, ledger})` → returns a draft object, not committed.
- `DraftVoucherPreviewCard.tsx` in chat — Enter commits, Esc discards; tagged `source: 'ai'` in DB.
- Undo stack for last 5 AI writes (one-key restore).

**C2. Reversal / duplicate helpers**
- Tools: `reverse_voucher(id)`, `duplicate_voucher(id, newDate)`, `create_contra(...)`.
- All draft-first, same preview flow.

---

## Phase D — Explain-and-teach (item 4)

- Every fact card gains a click-through to the exact voucher list backing it (route to sales/purchase/ledger filtered).
- "Teach me" toggle in `AssistantChat.tsx` — re-prompts with reasoning-visible instructions and cites the applied standard (§44AD, AS-2, MSMED §16).

---

## Phase E — Cross-document intelligence (item 6)

- File input in `AssistantChat.tsx` accepting PDF/JPG/PNG/CSV.
- `src/lib/ai/ingest/` — router by MIME:
  - PDF party statement → reconcile against ledger → mismatch table.
  - Image bill → Gemini vision OCR → draft purchase voucher.
  - Bank CSV → line-by-line contra/receipt/payment suggestions with confidence.
- Reuses draft-first flow from Phase C.

---

## Phase F — Voice output & continuous dictation (item 9)

- TTS via `openai/gpt-4o-mini-tts` for briefings and short answers (button per message).
- Continuous dictation mode toggle for long narrations (existing STT loop extended).

---

## Phase G — Local-first LLM (item 10)

- WebLLM (Qwen 2.5 3B or Llama 3.2 1B) loaded on demand.
- Setting: "Never send party names/amounts to cloud" → tier-1 intents (balance lookup, list vouchers) run locally; cloud only for narrative summaries after redaction.
- Redactor swaps party names → tokens before cloud call, unswaps in response.

---

## Suggested first turn

Ship **Phase A (A1 + A2 + A3)** immediately — ~4 files, no UI regressions, and every later phase reads from these. Then Phase B in the following turn.

**Technical notes**
- All new persistence stays in local IndexedDB per the local-only-data core memory — no server sync.
- All AI tools go through the existing `retrievers.ts` boundary; no direct DB access from prompts.
- Confidence + trace envelope is a superset of today's response — old call sites keep working.

Reply with **"go phase A"** (or name specific items) and I'll implement.
