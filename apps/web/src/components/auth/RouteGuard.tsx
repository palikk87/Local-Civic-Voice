import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Lock, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { LoadingScreen } from "@/components/LoadingScreen";
import { useAuthUI, usePermissions } from "@/hooks/use-civic-auth";
import { useAdminStore } from "@/lib/mobile/admin-store";
import { requiredRoleFor, type Capability } from "@/lib/permissions";

interface RouteGuardProps {
  /** What this page is for — decides the tier needed. */
  capability: Capability;
  /** Shown in the sign-in dialog and on the blocked screen. */
  reason: string;
  children: React.ReactNode;
}

/**
 * Wraps a route that isn't public.
 *
 * Member pages: guests get a sign-in wall (with the dialog opened for them) rather
 * than a redirect, so the URL they came for still works once they're signed in.
 *
 * Admin pages: redirected to /admin/login, matching mobile's admin dashboard, which
 * does `router.replace('/admin/login')` when there's no admin session. The stored
 * admin token is re-verified against the server on mount so an expired token can't
 * keep the console open.
 */
export function RouteGuard({ capability, reason, children }: RouteGuardProps) {
  const { can, isLoading, isAuthenticated, sessionUnavailable } = usePermissions();
  const { openAuth } = useAuthUI();
  const location = useLocation();
  const verifySession = useAdminStore((s) => s.verifySession);
  const hasAdminSession = useAdminStore((s) => s.isAdminAuthenticated);

  const needsAdmin = requiredRoleFor(capability) === "admin";
  const allowed = can(capability);

  // Re-check the stored admin token with the server whenever an admin route mounts.
  useEffect(() => {
    if (needsAdmin && hasAdminSession) void verifySession();
  }, [needsAdmin, hasAdminSession, verifySession]);

  // NOT A SIGN-IN PROBLEM. When the session could not be read at all, opening
  // the sign-in dialog is both wrong and cruel: the person may already be
  // signed in, and the sign-in they are being pushed towards cannot succeed
  // either — it needs the same server. Measured with the API switched off:
  // fifteen routes said "Sign in to continue" to signed-in readers.
  const needsSignIn = !isLoading && !isAuthenticated && !needsAdmin && !sessionUnavailable;

  useEffect(() => {
    if (needsSignIn) openAuth(reason);
  }, [needsSignIn, openAuth, reason]);

  if (isLoading) return <LoadingScreen />;
  if (allowed) return <>{children}</>;

  // Say what is actually wrong, before deciding anything about this visitor.
  if (sessionUnavailable) return <ServiceUnreachable />;

  // Admin console has its own login screen and its own session.
  if (needsAdmin) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }

  return <SignInWall reason={reason} onSignIn={() => openAuth(reason)} />;
}

/**
 * The server could not be reached, so nothing is known about this visitor.
 *
 * Deliberately makes no claim about their account and offers no sign-in: both
 * would be guesses, and the second cannot work while this screen is showing.
 */
function ServiceUnreachable() {
  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center py-24 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-slate-500/15 flex items-center justify-center">
          <CloudOff size={28} className="text-slate-400" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white">We can&apos;t reach the server</h1>
        <p className="mt-2 text-slate-400">
          This is on our side, not yours — you may well still be signed in. Nothing you have
          posted or voted on has been lost.
        </p>
        <div className="mt-8">
          <Button onClick={() => window.location.reload()} className="min-h-[44px]">
            Try again
          </Button>
        </div>
      </div>
    </AppShell>
  );
}

function SignInWall({ reason, onSignIn }: { reason: string; onSignIn: () => void }) {
  const navigate = useNavigate();

  return (
    <AppShell>
      <div className="flex flex-col items-center justify-center py-24 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-amber-500/15 flex items-center justify-center">
          <Lock size={28} className="text-amber-500" />
        </div>
        <h1 className="mt-6 text-2xl font-bold text-white">Sign in to continue</h1>
        <p className="mt-2 text-slate-400">{reason}</p>
        <p className="mt-4 text-sm text-slate-500">
          You can keep browsing bills, executive orders, and Supreme Court cases without an account.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button onClick={onSignIn} className="min-h-[44px]">
            Sign in or create account
          </Button>
          <Button variant="outline" className="min-h-[44px]" onClick={() => navigate("/discover")}>
            Browse public records
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
