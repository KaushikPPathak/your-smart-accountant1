// Diagonal "UNLICENSED COPY" watermark stamped on every page of a
// generated PDF when the app is running in trial-ended (or unactivated)
// mode. Trial and licensed states get no watermark — the whole point of a
// trial is that it looks and feels like the real thing.
//
// Call this AFTER all page content is drawn, right before `doc.output(...)`.

import type jsPDF from "jspdf";
import { getLicenseState } from "./state";

export async function stampWatermarkIfUnlicensed(doc: jsPDF): Promise<void> {
  const state = await getLicenseState();
  if (state.mode !== "expired") return; // trial + licensed → clean output

  const totalPages =
    (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const gs = (doc as unknown as {
      GState: new (o: { opacity: number }) => unknown;
      setGState: (g: unknown) => void;
    });
    try { gs.setGState(new gs.GState({ opacity: 0.18 })); } catch { /* older jsPDF */ }
    doc.setTextColor(180, 30, 30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(72);
    doc.text("UNLICENSED COPY", pageWidth / 2, pageHeight / 2, {
      align: "center",
      angle: 30,
    } as unknown as { align: "center"; angle: number });
    doc.setFontSize(10);
    doc.text(
      "Trial expired — activate a license in Settings › License",
      pageWidth / 2,
      pageHeight / 2 + 36,
      { align: "center", angle: 30 } as unknown as { align: "center"; angle: number },
    );
    try { gs.setGState(new gs.GState({ opacity: 1 })); } catch { /* ignore */ }
    doc.setTextColor(0, 0, 0);
  }
}
