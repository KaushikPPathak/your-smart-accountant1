# Assistant Orchestration Consolidation & Performance Plan

Consolidate AI logic into a central backend library, precompute common answers via idle-time cache warmup, and optimize prompts with just-in-time intent-based injection.

## Proposed Changes

### 1. Centralize Orchestration (src/lib/assistant.functions.ts)
- Move all tool-calling loops, intent routing, and company/voucher parsing from `AssistantChat.tsx` to `assistant.functions.ts`.
- `AssistantChat` will become a "dumb" view that calls `assistantChat()` and displays the returned text/cards/tool-trails.
- Implement a robust multi-intent router in `assistant.functions.ts` that handles:
  - Knowledge Base (KB) search (offline).
  - Deterministic accounting lookups (local-first).
  - Voucher creation/drafting intent.
  - LLM-based reasoning (Cloud/Local) with tool support.

### 2. Cache Warmup (src/lib/ai/cache-warmup.ts)
- Wire `scheduleWarmup` into `src/routes/app.tsx` so it runs after a company is opened and the browser is idle.
- The warmup will pre-fill the `answer-cache` with common queries (Cash balance, Bank balance, Sales summary) using `assistantChat`'s local-first path.

### 3. Just-in-Time Prompt Builder (src/lib/ai/sqliteContext.ts)
- Refactor `buildCompressedContext` to dynamically construct the system prompt.
- Only inject instructions relevant to the detected intent:
  - `voucher_create` -> Inject voucher drafting JSON schema and ledger picking rules.
  - `accounting_query` -> Inject Indian accounting style guide and verification rules.
  - `greeting` -> Inject minimal persona instructions.
- This reduces context length, improving local model performance and attention accuracy.

## Technical Details

- **AssistantChat.tsx**: Remove logic for `detectCreateCompanyIntent`, `parseCompanyDetails`, `tryDirectToolAnswer`, and `ask`. Replace with a single call to `assistantChat`.
- **assistant.functions.ts**:
  - Update `AssistantChatResult` to include metadata needed for UI state (e.g., `voucherPreview`, `ocrPreview`).
  - Integrate `searchKb` for offline FAQ support.
  - Integrate `detectVoucherIntent` for drafting.
- **sqliteContext.ts**:
  - Create specialized prompt fragments for each `IntentType`.
  - Maintain the core "ground truth" verification rules for all intents.
- **app.tsx**: Add `scheduleWarmup(activeCompanyId)` in the company activation effect.

## User Impact

- **Speed**: Frequent questions like "What is my bank balance?" will answer instantly from cache.
- **Reliability**: Centralized logic ensures that local-first answers and LLM answers stay consistent.
- **Efficiency**: Smaller prompts mean faster responses from local models (WebLLM).
