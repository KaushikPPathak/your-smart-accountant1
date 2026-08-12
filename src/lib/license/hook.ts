// React hook — subscribes to license state changes so banners / gates
// refresh immediately after activation without a page reload.

import { useEffect, useState } from "react";
import { getLicenseState, type LicenseState } from "./state";

const listeners = new Set<() => void>();

export function notifyLicenseChanged(): void {
  listeners.forEach((l) => l());
}

const EMPTY: LicenseState = {
  mode: "trial",
  plan: "trial",
  daysLeft: 30,
  expiresAt: null,
  customerName: null,
  customerEmail: null,
  licenseId: null,
  deviceCount: 0,
  maxDevices: 0,
};

export function useLicenseState(): LicenseState {
  const [state, setState] = useState<LicenseState>(EMPTY);
  useEffect(() => {
    let alive = true;
    const load = () => {
      getLicenseState().then((s) => { if (alive) setState(s); }).catch(() => undefined);
    };
    load();
    listeners.add(load);
    return () => { alive = false; listeners.delete(load); };
  }, []);
  return state;
}
