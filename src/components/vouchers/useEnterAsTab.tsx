import { useFormEnterNav } from "@/lib/keyboard";

/**
 * Voucher-form Enter navigation. Thin adapter over the centralized keyboard
 * engine's {@link useFormEnterNav}. Kept as a named export so existing voucher
 * screens do not need to change their imports.
 *
 * See `src/lib/keyboard/useFormEnterNav.ts` for the full behavior contract.
 */
export function useEnterAsTab(onLast?: () => void) {
  return useFormEnterNav<HTMLDivElement>({ onLast });
}
