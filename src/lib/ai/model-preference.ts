// Phase G — Local-first LLM preference.
//
// The user decides where their questions are answered:
//   auto   — try the on-device model (WebGPU) first, fall back to cloud.
//   local  — on-device only; never send the question off the machine.
//   cloud  — always use the hosted model (best quality, needs network).
//
// Business data never leaves the device regardless of this setting; this
// only controls where the *question and retrieved context snippet* go.

export type ModelPreference = "auto" | "local" | "cloud";

const KEY = "ym.ai.model_preference";

export function getModelPreference(): ModelPreference {
  if (typeof localStorage === "undefined") return "auto";
  const v = localStorage.getItem(KEY);
  return v === "local" || v === "cloud" ? v : "auto";
}

export function setModelPreference(p: ModelPreference): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* private mode — preference simply isn't persisted */
  }
}

export function modelPreferenceLabel(p: ModelPreference): string {
  return p === "local" ? "On-device only" : p === "cloud" ? "Cloud model" : "Auto (device first)";
}
