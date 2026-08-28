// Web port of mobile/src/app/admin/settings.tsx — admin session info + sign out.
import { useNavigate } from "react-router-dom";
import { LogOut, Shield, KeyRound, Clock } from "lucide-react";
import { useAdminStore } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KeysAndEmailCard } from "./KeysAndEmailCard";
import { IncidentsCard } from "./IncidentsCard";

export function SettingsTab() {
  const navigate = useNavigate();
  const session = useAdminStore((s) => s.session);
  const adminLogout = useAdminStore((s) => s.adminLogout);

  const handleLogout = async () => {
    await adminLogout();
    navigate("/admin/login", { replace: true });
  };

  return (
    <div className="max-w-xl space-y-4">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/20">
            <Shield className="h-6 w-6 text-purple-400" />
          </div>
          <div>
            <p className="font-medium text-foreground">{session?.username}</p>
            <Badge variant="secondary" className="mt-0.5 capitalize">
              {session?.role}
            </Badge>
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <KeyRound className="h-4 w-4" />
            Admin ID: <span className="text-foreground">{session?.adminId}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            Session expires:{" "}
            <span className="text-foreground">
              {session?.expiresAt ? new Date(session.expiresAt).toLocaleString() : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ABOVE THE KEYS ON PURPOSE. When something is running on a fallback,
          that is the first thing an operator needs to know — and the cause is
          usually one screen down. */}
      <IncidentsCard />

      <KeysAndEmailCard />

      <div className="rounded-lg border border-border bg-card p-5">
        <p className="mb-1 font-medium text-foreground">About the console</p>
        <p className="text-sm text-muted-foreground">
          The admin console is a separate login from citizen accounts. Every action here is
          recorded in the activity log, and the same rules apply on the mobile app — one
          platform, one set of controls.
        </p>
      </div>

      <Button variant="destructive" onClick={handleLogout}>
        <LogOut className="mr-2 h-4 w-4" />
        Sign out of admin console
      </Button>
    </div>
  );
}
