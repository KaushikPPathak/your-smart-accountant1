// GST verification client — API Setu (apisetu.gov.in) GSTN Tax Payer API V2.
// Forces direct connection and clears old cached credentials automatically.

const LS_KEY = "ym_setu_creds_v1";

export interface SetuCreds {
  clientId: string;
  clientSecret: string;
  productInstanceId?: string;
  environment: "production" | "sandbox";
}

// HARDCODED ACTIVE CREDENTIALS
const ACTIVE_CREDS: SetuCreds = {
  clientId: "com.shcglobaltrade",
  clientSecret: "df93df0e036268e83bcffd824287952374c0b4aa624c25bc52df419f084a4743",
  productInstanceId: "",
  environment: "production",
};

export function loadSetuCreds(): SetuCreds {
  // This safely deletes the bad API key from your local storage automatically
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // Ignore if storage access is restricted
    }
  }
  return { ...ACTIVE_CREDS };
}

export function saveSetuCreds(creds: SetuCreds): void {
  // We are hardcoding the keys now, but keep this so the UI doesn't crash if it tries to save
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(creds));
    } catch {}
  }
}

export function isSetuConfigured(): boolean {
  return true;
}

export interface SetuGstinResult {
  success: boolean;
  error?: string;
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;
  registrationDate?: string;
  taxpayerType?: string;
  constitutionOfBusiness?: string;
  natureOfBusinessActivities?: string[];
  principalPlaceOfBusiness?: string;
  raw?: unknown;
}

function compactAddress(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim() || undefined;
  if (typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const nested = compactAddress(
    obj.principalPlaceOfBusinessAddress ||
    obj.additionalPlaceOfBusinessAddress ||
    obj.address ||
    obj.addr ||
    obj.adr,
  );
  if (nested) return nested;
  const parts = [
    obj.bno || obj.buildingNumber || obj.bnumber,
    obj.flno || obj.floorNumber,
    obj.bnm || obj.buildingName,
    obj.st || obj.street || obj.streetName,
    obj.loc || obj.location || obj.locality,
    obj.landMark || obj.landmark || obj.lm,
    obj.city || obj.dst || obj.district || obj.districtName,
    obj.stcd || obj.state || obj.stateName,
    obj.pncd || obj.pincode || obj.pin,
  ];
  return parts.map((p) => (p == null ? "" : String(p).trim())).filter(Boolean).join(", ") || undefined;
}

/**
 * Verify a GSTIN via API Setu's GSTN Tax Payer API V2.
 */
export async function lookupGstinViaSetu(gstin: string): Promise<SetuGstinResult> {
  const cleanGstin = (gstin || "").trim().toUpperCase();
  const empty: SetuGstinResult = {
    success: false,
    gstin: cleanGstin,
    legalName: "",
    tradeName: "",
    status: "",
  };
  
  if (!cleanGstin) return { ...empty, error: "GSTIN is required" };

  let json: any = null;
  let httpOk = false;

  // ATTEMPT 1: Direct API Setu Request (Bypassing Proxy completely)
  try {
    const url = `https://apisetu.gov.in/gstn/v2/taxpayers/${encodeURIComponent(cleanGstin)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-APISETU-CLIENTID": ACTIVE_CREDS.clientId,
        "X-APISETU-APIKEY": ACTIVE_CREDS.clientSecret,
        "Accept": "application/json",
      },
    });
    
    if (res.ok) {
      httpOk = true;
      json = await res.json();
    }
  } catch (err) {
    console.warn("Direct Setu Fetch Error:", err);
  }

  // ATTEMPT 2: If offline or API fails, cleanly open the manual portal
  if (!httpOk) {
    if (typeof window !== "undefined") {
      window.open("https://services.gst.gov.in/services/searchtp", "_blank");
    }
    // Returning success: false will trigger the UI's toast, but the manual browser tab will open properly
    return { ...empty, error: "Offline Mode: Opened GST Portal in browser." };
  }

  // Parse successful response
  const d = (json && (json.data || json)) || {};
  const legalName = String(d.legalName || d.legalNameOfBusiness || d.lgnm || "").trim();
  const tradeName = String(d.tradeName || d.tradeNameOfBusiness || d.tradNam || legalName).trim();
  
  // Failsafe: If response is 200 OK but missing data, open portal
  if (!legalName && !tradeName) {
    if (typeof window !== "undefined") window.open("https://services.gst.gov.in/services/searchtp", "_blank");
    return { ...empty, error: "Invalid GSTIN or empty record." };
  }

  return {
    success: true,
    gstin: cleanGstin,
    legalName,
    tradeName: tradeName || legalName,
    status: String(d.status || d.sts || d.gstinStatus || "Active").trim(),
    registrationDate: d.dateOfRegistration || d.rgdt ? String(d.dateOfRegistration || d.rgdt) : undefined,
    taxpayerType: d.taxpayerType || d.dty ? String(d.taxpayerType || d.dty) : undefined,
    constitutionOfBusiness: d.constitutionOfBusiness || d.ctb ? String(d.constitutionOfBusiness || d.ctb) : undefined,
    natureOfBusinessActivities: Array.isArray(d.natureOfBusinessActivity || d.nba) ? (d.natureOfBusinessActivity || d.nba).map(String) : undefined,
    principalPlaceOfBusiness: compactAddress(d.principalPlaceOfBusinessFields || d.principalPlaceOfBusiness || d.pradr || d.address),
    raw: json,
  };
}
