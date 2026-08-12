// Web port of mobile/src/app/admin/login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shield, Eye, EyeOff, ArrowLeft, Lock, Loader2 } from "lucide-react";
import { useAdminStore } from "@/lib/mobile/admin-store";
import { cn } from "@/lib/utils";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string>("");

  const isLoading = useAdminStore((s) => s.isLoading);
  const adminLogin = useAdminStore((s) => s.adminLogin);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("Please enter both username and password");
      return;
    }

    setError("");
    const result = await adminLogin(username.trim(), password);

    if (result.success) {
      navigate("/admin", { replace: true });
    } else {
      setError(result.error || "Login failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-slate-800">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 min-h-[44px] min-w-[44px]">
          <ArrowLeft size={24} color="#94A3B8" />
        </button>
        <h1 className="text-white text-lg font-semibold ml-2">Admin Login</h1>
      </div>

      <form
        className="flex flex-col justify-center px-6 py-16 max-w-md mx-auto"
        onSubmit={(e) => {
          e.preventDefault();
          void handleLogin();
        }}
      >
        {/* Logo Section */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mb-4">
            <Shield size={40} color="#F59E0B" />
          </div>
          <h2 className="text-white text-2xl font-bold">Admin Console</h2>
          <p className="text-slate-400 text-center mt-2">
            Enter your admin credentials to access the management dashboard
          </p>
        </div>

        {/* Error Message */}
        {error ? (
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4 mb-4">
            <p className="text-red-400 text-center">{error}</p>
          </div>
        ) : null}

        {/* Username Input */}
        <div className="mb-4">
          <label htmlFor="admin-username" className="block text-slate-400 text-sm mb-2 font-medium">
            Username
          </label>
          <div className="bg-slate-800 border border-slate-700 rounded-xl flex items-center px-4">
            <Shield size={20} color="#64748B" />
            <input
              id="admin-username"
              className="flex-1 bg-transparent text-white py-4 px-3 text-base outline-none"
              placeholder="Enter admin username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
            />
          </div>
        </div>

        {/* Password Input */}
        <div className="mb-6">
          <label htmlFor="admin-password" className="block text-slate-400 text-sm mb-2 font-medium">
            Password
          </label>
          <div className="bg-slate-800 border border-slate-700 rounded-xl flex items-center px-4">
            <Lock size={20} color="#64748B" />
            <input
              id="admin-password"
              type={showPassword ? "text" : "password"}
              className="flex-1 bg-transparent text-white py-4 px-3 text-base outline-none"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="p-2 min-h-[44px] min-w-[44px]"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={20} color="#64748B" /> : <Eye size={20} color="#64748B" />}
            </button>
          </div>
        </div>

        {/* Login Button */}
        <button
          type="submit"
          disabled={isLoading}
          className={cn(
            "py-4 rounded-xl flex items-center justify-center min-h-[44px] transition-colors",
            isLoading ? "bg-amber-500/50" : "bg-amber-500 hover:bg-amber-400"
          )}
        >
          {isLoading ? (
            <Loader2 size={20} className="animate-spin text-slate-900" />
          ) : (
            <>
              <Shield size={20} color="#0F172A" />
              <span className="text-slate-900 font-bold text-base ml-2">Sign In to Admin</span>
            </>
          )}
        </button>

        {/* Security Notice */}
        <div className="mt-8 flex justify-center">
          <p className="text-slate-500 text-xs text-center">
            This is a secure admin area. All actions are logged.
          </p>
        </div>
      </form>
    </div>
  );
}
