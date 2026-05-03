import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: () => void;
  title?: string;
  description?: string;
}

export function AcceptConfirm({ open, onOpenChange, onAccept, title = "Accept this voucher?", description = "Press Y or Enter to accept · N or Esc to cancel" }: Props) {
  const yesRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => yesRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "y" || e.key === "Y") {
        e.preventDefault();
        onOpenChange(false);
        onAccept();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, onAccept, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <kbd className="mr-1 rounded border px-1 font-mono text-xs">N</kbd> No
          </Button>
          <Button
            ref={yesRef}
            onClick={() => { onOpenChange(false); onAccept(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onOpenChange(false); onAccept(); }
            }}
          >
            <kbd className="mr-1 rounded border px-1 font-mono text-xs">Y</kbd> Accept
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
