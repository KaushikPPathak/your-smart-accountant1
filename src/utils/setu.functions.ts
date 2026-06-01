// Client-side stubs for Setu e-invoice/e-way-bill integration. The Setu
// credentials are server secrets; the SPA build cannot call Setu directly
// without exposing them. These return "unavailable" until a proxy is added.

export interface SetuStatus {
  configured: boolean;
  einvoiceEnabled: boolean;
  ewaybillEnabled: boolean;
  environment: string;
  message?: string;
}

export async function getSetuStatus(
  _args?: { data: { companyId: string } },
): Promise<SetuStatus> {
  return {
    configured: false,
    einvoiceEnabled: false,
    ewaybillEnabled: false,
    environment: "sandbox",
    message: "Setu integration is currently unavailable in this build.",
  };
}

export async function saveSetuCredentials(
  _args?: { data: unknown },
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "Setu credentials cannot be saved from this build." };
}

export async function generateIrn(
  _args?: { data: unknown },
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "IRN generation is currently unavailable in this build." };
}

export async function generateEwb(
  _args?: { data: unknown },
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: "E-way bill generation is currently unavailable in this build." };
}
