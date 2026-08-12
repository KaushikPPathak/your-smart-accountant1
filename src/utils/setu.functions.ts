// Client-side stubs for Setu e-invoice/e-way-bill integration.
// Original server functions returned snake_case/camelCase fields used by
// existing callers — we preserve those shapes here.

export interface SetuStatus {
  configured: boolean;
  einvoice_enabled: boolean;
  ewaybill_enabled: boolean;
  environment: string;
  gstn_username?: string | null;
}

export async function getSetuStatus(
  _args?: { data: { companyId: string } },
): Promise<SetuStatus> {
  return {
    configured: false,
    einvoice_enabled: false,
    ewaybill_enabled: false,
    environment: "sandbox",
    gstn_username: null,
  };
}

export async function saveSetuCredentials(
  _args?: { data: unknown },
): Promise<{ success: boolean; error?: string }> {
  return { success: false, error: "Setu integration is currently unavailable in this build." };
}

export interface IrnResult {
  success: boolean;
  error?: string;
  irn?: string;
  ackNo?: string;
}

export async function generateIrn(_args?: { data: unknown }): Promise<IrnResult> {
  return { success: false, error: "IRN generation is currently unavailable in this build." };
}

export interface EwbResult {
  success: boolean;
  error?: string;
  ewbNo?: string;
  ewbValidUntil?: string;
}

export async function generateEwb(_args?: { data: unknown }): Promise<EwbResult> {
  return { success: false, error: "E-way bill generation is currently unavailable in this build." };
}
