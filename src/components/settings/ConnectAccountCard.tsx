// Connect Account card for local-first users.
//
// When the app is used without an account, all data lives on this device
// only. This card explains the trade-off and lets the user opt-in to a
// cloud account for backup / multi-device / recovery. When an account is
// already connected, it shows the linked identity and a sign-out button.

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Cloud, CloudOff, LogIn, LogOut, ShieldCheck, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getActiveStaff, lockWorkspace } from "@/lib/staff-session";
import { isLocalProfileLinked, hasLocalDeviceProfile } from "@/lib/local-device-profile";

export function ConnectAccountCard() {
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("focus", bump);
    return () => window.removeEventListener("focus", bump);
  }, []);
  void tick;

  const staff = getActiveStaff();
  const staffIsDevice = !!staff && staff.id.startsWith("dev-");
  const isLinked = !!staff && !staffIsDevice && isLocalProfileLinked();
  const isLocalOnly = !isLinked && (staffIsDevice || hasLocalDeviceProfile());
  void isLocalOnly;

  return (
    <Card id="connect-account">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {isLinked ? <Cloud className="h-4 w-4 text-primary" /> : <CloudOff className="h-4 w-4 text-muted-foreground" />}
          Connect account
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLinked ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/50 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-success" />
              <div className="flex-1 text-sm">
                <div className="font-medium">
                  Signed in as {staff?.name || "User"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Role: {staff?.role ?? "—"}. Your local companies are linked to this account.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { lockWorkspace(); navigate({ to: "/lock" }); }}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" /> Sign out
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You're using Smart Accountant in <strong>local mode</strong> — your books are stored only on this computer.
              Connect an account to enable:
            </p>
            <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
              <li>Cloud backup to your own storage</li>
              <li>Access from another device</li>
              <li>Password recovery</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => navigate({ to: "/lock" })}>
                <LogIn className="mr-1.5 h-3.5 w-3.5" /> Sign in
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate({ to: "/lock" })}>
                <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Create account
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Your existing local companies will be linked to the new account automatically. No data is lost.
            </p>
            
          </>
        )}
      </CardContent>
    </Card>
  );
}
