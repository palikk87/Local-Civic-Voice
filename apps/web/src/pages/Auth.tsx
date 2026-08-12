import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Vote, Compass } from "lucide-react";
import { AuthForm } from "@/components/auth/AuthForm";
import { useCurrentUser } from "@/hooks/use-civic-auth";

/**
 * Full-screen /auth route mirroring the mobile login/signup screens:
 * a slate→navy→slate gradient with a centered card and amber logo mark.
 */
export default function Auth() {
  const { isAuthenticated, isLoading } = useCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate("/explore", { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#0F172A] via-[#1E3A5F] to-[#0F172A] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-accent/20">
            <Vote className="h-12 w-12 text-accent" />
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-white">
            Civic Voice
          </h1>
          <p className="mt-2 text-slate-400">
            Sign in or create your account to make your voice heard.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-2xl backdrop-blur-sm sm:p-8">
          <AuthForm mode="signin" onSuccess={() => navigate("/explore")} />
        </div>

        {/* No account needed to look around — same escape hatch the mobile app offers. */}
        <button
          type="button"
          onClick={() => navigate("/discover")}
          className="mx-auto mt-6 flex items-center gap-2 text-sm text-slate-400 transition-colors hover:text-white"
        >
          <Compass className="h-4 w-4" />
          Browse without an account
        </button>
      </div>
    </div>
  );
}
