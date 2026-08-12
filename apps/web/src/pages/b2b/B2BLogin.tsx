// Web port of webapp/mobile/src/app/b2b/login.tsx — B2B portal credential login.
// Same endpoint (/api/b2b/auth/credential-login via the shared b2b store).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Eye,
  EyeOff,
  ArrowLeft,
  User,
  Lock,
  Building2,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { useB2BStore } from "@/lib/mobile/b2b-store";

export default function B2BLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isLoading = useB2BStore((s) => s.isLoading);
  const login = useB2BStore((s) => s.login);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password");
      return;
    }

    setError("");
    const result = await login(username.trim(), password);

    if (result.success) {
      navigate("/b2b/dashboard", { replace: true });
    } else {
      setError(result.error ?? "Authentication failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 bg-gradient-to-b from-[#0F172A] via-[#1E1B4B] to-[#0F172A]">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6">
        {/* Header */}
        <div className="flex items-center py-4">
          <button onClick={() => navigate(-1)} className="-ml-2 p-2" aria-label="Back">
            <ArrowLeft size={24} color="#94A3B8" />
          </button>
        </div>

        <div className="flex flex-1 flex-col justify-center pb-16">
          {/* Logo */}
          <div className="mb-10 flex flex-col items-center">
            <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-3xl border border-indigo-500/30 bg-indigo-500/20">
              <BarChart3 size={48} color="#818CF8" />
            </div>
            <span className="text-3xl font-bold text-white">Civic Intelligence</span>
            <span className="mt-1 text-lg text-indigo-300">B2B Analytics Platform</span>
            <p className="mt-4 px-4 text-center text-slate-400">
              Real-time public sentiment analytics for informed decision making
            </p>
          </div>

          {/* Features */}
          <div className="mb-8 flex justify-center gap-6">
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20">
                <TrendingUp size={24} color="#34D399" />
              </div>
              <span className="text-xs text-slate-400">Sentiment</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20">
                <Building2 size={24} color="#FBBF24" />
              </div>
              <span className="text-xs text-slate-400">Districts</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/20">
                <BarChart3 size={24} color="#A78BFA" />
              </div>
              <span className="text-xs text-slate-400">Analytics</span>
            </div>
          </div>

          {error ? (
            <div className="mb-4 rounded-xl border border-red-500/50 bg-red-500/20 p-4">
              <p className="text-center text-red-400">{error}</p>
            </div>
          ) : null}

          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-slate-400">Username</label>
              <div className="flex items-center rounded-xl border border-slate-700 bg-slate-800/50 px-4">
                <User size={20} color="#64748B" />
                <input
                  className="flex-1 bg-transparent px-3 py-4 text-base text-white outline-none placeholder:text-slate-500"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoCapitalize="none"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="mb-6">
              <label className="mb-2 block text-sm font-medium text-slate-400">Password</label>
              <div className="flex items-center rounded-xl border border-slate-700 bg-slate-800/50 px-4">
                <Lock size={20} color="#64748B" />
                <input
                  className="flex-1 bg-transparent px-3 py-4 text-base text-white outline-none placeholder:text-slate-500"
                  placeholder="Enter your password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-2"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff size={20} color="#64748B" />
                  ) : (
                    <Eye size={20} color="#64748B" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#4338CA] to-[#6366F1] py-4 font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <BarChart3 size={20} color="white" />
                  <span className="ml-2">Access Analytics</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-500">
              This platform provides aggregated, anonymous public sentiment data.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              No individual user data is shared or exposed.
            </p>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-500">
              Need access? <span className="text-indigo-400">Contact sales</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
