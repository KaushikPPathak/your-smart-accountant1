const lastNarration: Record<string, string> = {};
export function rememberNarration(voucherType: string, value: string) {
  if (value && value.trim()) lastNarration[voucherType] = value;
}
export function recallNarration(voucherType: string): string {
  return lastNarration[voucherType] ?? "";
}
