import { validateGSTIN } from "@/utils/gstinValidator";

interface Props {
  value: string;
  className?: string;
}

/** Inline (non-blocking) GSTIN validation message. Renders nothing when empty or valid. */
export function GstinInlineError({ value, className }: Props) {
  const v = (value || "").trim();
  if (!v) return null;
  const res = validateGSTIN(v);
  if (res.valid) return null;
  return (
    <p className={`text-xs text-destructive ${className ?? ""}`}>
      {res.error}
    </p>
  );
}
