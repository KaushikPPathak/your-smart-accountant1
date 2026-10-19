import { toStateCode } from "@/lib/gst";

/** Refresh the editing draft only; persisted vouchers change on explicit save.
 * Retain a distinct invoice PoS; a local PoS on an old local invoice is the
 * legacy inferred default, which must not mask a corrected party GSTIN.
 */
export function resolveEditedGstDirection(
  voucher: { is_interstate: boolean; place_of_supply_code: string | null },
  company: { state_code?: string | null; state?: string | null; gstin?: string | null },
  party: { state_code?: string | null; state?: string | null; gstin?: string | null } | null,
) {
  const companyCode = toStateCode(company.gstin) || toStateCode(company.state_code) || toStateCode(company.state);
  const partyCode = toStateCode(party?.gstin) || toStateCode(party?.state_code) || toStateCode(party?.state);
  const savedPos = toStateCode(voucher.place_of_supply_code);
  const explicitPos = savedPos && (voucher.is_interstate || savedPos !== companyCode) ? savedPos : null;
  const destination = explicitPos || partyCode;
  if (!companyCode || !destination) return { is_interstate: voucher.is_interstate, place_of_supply_code: voucher.place_of_supply_code };
  return { is_interstate: companyCode !== destination, place_of_supply_code: destination };
}