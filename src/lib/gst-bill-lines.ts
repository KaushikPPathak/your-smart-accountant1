/**
 * Allocate saved bill tax to reporting lines in integer paise, never round-off.
 *
 * Rule: each line's share is the cumulative weight rounded to paise, minus what was already given.
 * Weight is the line's tax when the lines already carry tax, else taxable × rate. The last line
 * takes whatever is left, so the lines sum exactly to the header tax. If every weight is zero, the
 * header tax cannot be placed and the lines are left unchanged.
 */
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
/**
 * Header tax that no line can carry: when every weight is zero (for example all lines are
 * 0% but the bill still shows tax), reconcileBillTaxLines leaves the lines unchanged and this
 * reports the amount left unplaced, per tax head, in paise. Zero means every header tax is placed.
 */
export function unplacedBillTax<T extends { taxable_paise: number; gst_rate: number; cgst_paise: number; sgst_paise: number; igst_paise: number }>(
  lines: T[], header: { cgst_paise: number; sgst_paise: number; igst_paise: number },
): { cgst_paise: number; sgst_paise: number; igst_paise: number } {
  const out = { cgst_paise: 0, sgst_paise: 0, igst_paise: 0 };
  for (const key of ["cgst_paise", "sgst_paise", "igst_paise"] as const) {
    const target = header[key];
    if (!Number.isFinite(target) || target <= 0) continue;
    const current = lines.reduce((sum, line) => sum + line[key], 0);
    if (current === target) continue;
    const weight = lines.reduce((sum, line) => sum + (current > 0 ? line[key] : Math.max(0, line.taxable_paise * line.gst_rate)), 0);
    if (!weight) out[key] = target - current;
  }
  return out;
}
