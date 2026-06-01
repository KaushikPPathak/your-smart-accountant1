// Client-side stub for GSTIN lookup. The third-party API key is a server
// secret that cannot live in the SPA bundle. Returns "unavailable" until a
// proxy endpoint is added.

export interface GstinLookupResult {
  ok: boolean;
  error?: string;
  data?: {
    legalName: string;
    tradeName: string;
    address: string;
    stateCode: string | null;
    state: string | null;
    status: string | null;
  };
}

export async function lookupGstin(
  _args?: { data: { gstin: string } },
): Promise<GstinLookupResult> {
  return {
    ok: false,
    error: "GSTIN auto-lookup is currently unavailable. Please enter details manually.",
  };
}
