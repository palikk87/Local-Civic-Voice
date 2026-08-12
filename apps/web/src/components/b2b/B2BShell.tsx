// Shared chrome for the web B2B portal (port of the per-screen guards + headers
// the mobile b2b screens repeat). Verifies the b2b session on mount and
// redirects to /b2b/login when invalid — same behavior as mobile.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  Map,
  Target,
  Building2,
  Activity,
  FileText,
  LogOut,
  Loader2,
  LayoutDashboard,
} from "lucide-react";
import { useB2BStore } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { path: "/b2b/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/b2b/heatmap", label: "Heatmap", icon: Map },
  { path: "/b2b/issues", label: "Issues", icon: Target },
  { path: "/b2b/states", label: "States", icon: Building2 },
  { path: "/b2b/forecast", label: "Forecast", icon: Activity },
  { path: "/b2b/reports", label: "Reports", icon: FileText },
];

function tierBadge(tier: string): { color: string; label: string } {
  switch (tier) {
    case "enterprise":
      return { color: "bg-purple-500", label: "Enterprise" };
    case "professional":
      return { color: "bg-blue-500", label: "Professional" };
    default:
      return { color: "bg-slate-500", label: "Basic" };
  }
}

export function B2BShell({ children, title }: { children: ReactNode; title?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState<boolean>(false);

  const hasHydrated = useB2BStore((s) => s._hasHydrated);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);
  const session = useB2BStore((s) => s.session);
  const verifySession = useB2BStore((s) => s.verifySession);
  const logout = useB2BStore((s) => s.logout);

  useEffect(() => {
    if (!hasHydrated) return;
    let cancelled = false;
    (async () => {
      const valid = await verifySession();
      if (cancelled) return;
      if (!valid) {
        navigate("/b2b/login", { replace: true });
      } else {
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasHydrated, verifySession, navigate]);

  const handleLogout = async () => {
    await logout();
    navigate("/b2b/login", { replace: true });
  };

  if (!hasHydrated || !checked || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-10 w-10 animate-spin" color="#818CF8" />
      </div>
    );
  }

  const badge = tierBadge(session?.tier ?? "basic");

  return (
    <div className="min-h-screen bg-slate-950 bg-gradient-to-b from-[#0F172A] via-[#1E1B4B] to-[#0F172A] text-white">
      {/* Header */}
      <header className="border-b border-slate-800/50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center">
            <button
              onClick={() => navigate("/profile")}
              className="mr-3 rounded-xl bg-slate-800/50 p-2 transition-colors hover:bg-slate-800"
              aria-label="Back to the app"
              title="Back to the app"
            >
              <ArrowLeft size={20} color="#94A3B8" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/20">
              <BarChart3 size={20} color="#818CF8" />
            </div>
            <div className="ml-3">
              <span className="block text-lg font-bold text-white">Civic Intelligence</span>
              <div className="flex items-center">
                <span className="text-sm text-slate-400">{session?.clientName}</span>
                <span
                  className={cn(
                    "ml-2 rounded-full px-2 py-0.5 text-xs font-medium text-white",
                    badge.color,
                  )}
                >
                  {badge.label}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="rounded-xl bg-slate-800/50 p-2 transition-colors hover:bg-slate-800"
            aria-label="Sign out of B2B portal"
          >
            <LogOut size={20} color="#EF4444" />
          </button>
        </div>

        {/* Nav */}
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={cn(
                  "flex shrink-0 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-indigo-500/20 text-indigo-300"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )}
              >
                <Icon size={15} className="mr-1.5" />
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {title ? <h1 className="mb-5 text-2xl font-bold text-white">{title}</h1> : null}
        {children}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
          <p className="text-sm text-slate-400">
            All data is aggregated and anonymized. Individual user information is never
            shared or accessible through this platform.
          </p>
        </div>
      </footer>
    </div>
  );
}
