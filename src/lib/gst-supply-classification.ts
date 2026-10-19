/** A zero rate AND zero charged tax identifies a tax-free domestic line.
 * This does not infer exemption: without explicit nature it is nil-rated.
 */
export function isTaxFreeGstLine(line: {
  gst_rate: number; igst_paise: number; cgst_paise: number; sgst_paise: number;
}): boolean {
  return Number(line.gst_rate || 0) === 0 && Number(line.igst_paise || 0) === 0
    && Number(line.cgst_paise || 0) === 0 && Number(line.sgst_paise || 0) === 0;
}