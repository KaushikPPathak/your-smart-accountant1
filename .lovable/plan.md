# Restoration Plan: Assistant Chat UI & Logic

Restore the `AssistantChat.tsx` UI components and logic that were lost during the centralization refactor, while ensuring they use the new `assistantChat` function from `assistant.functions.ts`.

## User Review Required
- Re-confirmation of the "Soft Sage & Cream" theme consistency (will be maintained).
- Re-confirmation of the "Mehtaji" naming (will be maintained).

## Proposed Changes

### Assistant Components
#### [Restoration] `src/components/assistant/AssistantChat.tsx`
- Re-implement the full UI:
    - `ScrollArea` for message history.
    - Message rendering for user, assistant, and system roles.
    - Integration of `AnswerProvenance`, `StreamingText`, `VoucherPreviewCard`, and `OcrPreviewCard`.
    - Knowledge Base (KB) browse categories and entries.
    - Input area with voice support (`useVoiceInput`), file drag-and-drop for OCR, and model preference selection.
    - Suggestions chip group.
    - Logic for handling `ParsedCompany` and `ParsedVoucher` previews returned by the new backend.
- Connect to the centralized `assistantChat` function.
- Ensure all imports for UI components (Card, Button, Badge, etc.) are correctly restored.

### Technical Details
- The component will act as a "thin view" as requested in Section 6.
- It will delegate routing, tool execution, and context building to `assistant.functions.ts`.
- It will handle the structured results (`card`, `pendingVoucher`, `pendingCompany`) to display appropriate UI fragments.
- Maintain existing local-only data ownership constraints.
