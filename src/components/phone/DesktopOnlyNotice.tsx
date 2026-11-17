import type { ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { Monitor } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isAndroidRuntime } from "@/lib/native-bridge";

/** Shown on the phone in place of screens that are only for the Windows app. */
export function DesktopOnlyNotice({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-8">
      <Card>
        <CardContent className="space-y-3 p-6 text-center">
          <Monitor className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            This screen is used on the Windows app. Nothing has been changed on this phone.
          </p>
          <Button asChild className="h-11 w-full">
            <Link to="/app">Back to home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Wraps a route page so the phone shows the notice instead. Hooks run inside
 * the wrapped page only when it is actually rendered, so hook order is safe.
 */
export function desktopOnly<P extends object>(title: string, Page: ComponentType<P>) {
  function Guarded(props: P) {
    if (isAndroidRuntime()) return <DesktopOnlyNotice title={title} />;
    return <Page {...props} />;
  }
  return Guarded;
}
