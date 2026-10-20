/** Allocate saved bill tax to reporting lines in integer paise, never round-off. */
export function reconcileBillTaxLines<T extends { taxable_paise: number; gst_rate: number; cgst_paise: number; sgst_paise: number; igst_paise: number }>(
  lines: T[], header: { cgst_paise: number; sgst_paise: number; igst_paise: number },
): T[] {
  const result = lines.map((line) => ({ ...line }));
  for (const key of ["cgst_paise", "sgst_paise", "igst_paise"] as const) {
    const target = header[key];
    if (!Number.isFinite(target) || target < 0) continue;
    const current = lines.reduce((sum, line) => sum + line[key], 0);
    if (current === target) continue;
    const weights = lines.map((line) => current > 0 ? line[key] : Math.max(0, line.taxable_paise * line.gst_rate));
    const weight = weights.reduce((sum, value) => sum + value, 0);
    if (!weight) continue;
    let cumulative = 0;
    let assigned = 0;
    result.forEach((line, index) => {
      cumulative += weights[index];
      const next = Math.round(target * cumulative / weight);
      line[key] = next - assigned;
      assigned = next;
    });
  }
  return result;
}