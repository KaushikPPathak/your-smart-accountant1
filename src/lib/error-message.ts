export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (!error || typeof error !== "object") return "Unknown error";

  const obj = error as Record<string, unknown>;
  const parts = [obj.message, obj.details, obj.hint, obj.code]
    .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
    .map(String)
    .filter(Boolean);
  if (parts.length > 0) return parts.join(" — ");

  try {
    const json = JSON.stringify(error);
    return json && json !== "{}" ? json : "Unknown error";
  } catch {
    return "Unknown error";
  }
}