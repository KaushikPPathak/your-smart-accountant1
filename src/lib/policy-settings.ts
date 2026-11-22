// Per-company policy thresholds. Stored in the local meta store under a key that includes the
// company id, so one company's settings never apply to another. They are kept per device for
// now: they do not sync to other devices (the company record has no settings field yet).
import { getMeta, setMeta } from "@/lib/offline/db";

export interface PolicySettings {
  /** 5.4: physical count variance warning floor, paise (₹500). */
  countVarianceFloorPaise: number;
  /** 5.4: physical count variance warning as a share of the line value, basis points (1%). */
  countVarianceRateBps: number;
  /** 6.5: round-off up to this many paise per invoice is absorbed automatically (₹1). */
  roundOffAutoPaise: number;
  /** 6.5: service advances at or above this amount show the GST-on-advance banner, paise (₹1,000). */
  advanceNoticePaise: number;
}

export const DEFAULT_POLICY: PolicySettings = {
  countVarianceFloorPaise: 50_000,
  countVarianceRateBps: 100,
  roundOffAutoPaise: 100,
  advanceNoticePaise: 100_000,
};

const key = (companyId: string) => `policy_settings:${companyId}`;

export async function loadPolicy(companyId: string): Promise<PolicySettings> {
  try {
    const saved = await getMeta<Partial<PolicySettings>>(key(companyId));
    return { ...DEFAULT_POLICY, ...(saved ?? {}) };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export async function savePolicy(companyId: string, next: PolicySettings): Promise<void> {
  await setMeta(key(companyId), next);
}

/** Count variance needs a reason when it exceeds the higher of the floor or the rate of the line value. */
export function countVarianceNeedsReason(varianceAbsPaise: number, lineValuePaise: number, policy: PolicySettings): boolean {
  const rateLimit = Math.round((Math.abs(lineValuePaise) * policy.countVarianceRateBps) / 10_000);
  return Math.abs(varianceAbsPaise) > Math.max(policy.countVarianceFloorPaise, rateLimit);
}
