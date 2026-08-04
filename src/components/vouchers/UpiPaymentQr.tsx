// Dynamic UPI payment QR for an invoice — regenerates whenever the bill
// total changes. Everything renders on-device.
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { QrCode } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatINR } from "@/lib/money";
import { buildUpiUri, loadUpiSettings, upiQrDataUrl, validateUpiSettings } from "@/lib/upi";

interface Props {
  companyId: string;
  amountPaise: number;
  invoiceNumber?: string;
}

export function UpiPaymentQr({ companyId, amountPaise, invoiceNumber }: Props) {
  const settings = loadUpiSettings(companyId);
  const configError = validateUpiSettings(settings);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const uri = configError
    ? ""
    : buildUpiUri({
        pa: settings.pa,
        pn: settings.pn,
        amountPaise,
        note: invoiceNumber ? `Invoice ${invoiceNumber}` : undefined,
        ref: invoiceNumber,
      });

  useEffect(() => {
    let alive = true;
    if (!uri) { setDataUrl(null); return; }
    upiQrDataUrl(uri).then((d) => { if (alive) setDataUrl(d); }).catch(() => { if (alive) setDataUrl(null); });
    return () => { alive = false; };
  }, [uri]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <QrCode className="h-4 w-4" /> Pay by UPI
        </CardTitle>
      </CardHeader>
      <CardContent>
        {configError ? (
          <p className="text-sm text-muted-foreground">
            {configError}. Add your UPI ID in{" "}
            <Link to="/app/settings" className="underline">Settings → UPI payment QR</Link> to show a
            scannable payment code on invoices.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-5">
            {dataUrl ? (
              <img
                src={dataUrl}
                alt={`UPI payment QR code for ${formatINR(amountPaise)}`}
                className="h-[180px] w-[180px] rounded-md border bg-background p-1"
                width={180}
                height={180}
              />
            ) : (
              <div className="h-[180px] w-[180px] animate-pulse rounded-md border bg-muted" />
            )}
            <div className="space-y-1 text-sm">
              <p className="font-mono text-lg font-semibold">{formatINR(amountPaise)}</p>
              <p className="font-medium">{settings.pn}</p>
              <p className="text-muted-foreground">{settings.pa}</p>
              {invoiceNumber && <p className="text-muted-foreground">Ref: {invoiceNumber}</p>}
              <p className="pt-1 text-xs text-muted-foreground">
                Scan with any UPI app — the amount updates with the bill total.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
