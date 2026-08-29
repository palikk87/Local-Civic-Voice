import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, LogOut, User as UserIcon, Vote, Settings as SettingsIcon, Bookmark, TrendingUp, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./NotificationBell";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Seal } from "@/components/civic/Seal";
import { useAuthUI, useCurrentUser } from "@/hooks/use-civic-auth";
import { signOut } from "@/lib/auth-client";
import { useAuthStore } from "@/lib/mobile/auth-store";
import { useQueryClient } from "@tanstack/react-query";

const NAV = [
  { to: "/explore", label: "Explore" },
  { to: "/library", label: "Library" },
  { to: "/delegates", label: "Delegates" },
  { to: "/trending", label: "Trending" },
  { to: "/documents", label: "Documents" },
];

function initials(name?: string | null, email?: string) {
  if (name) {
    return name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return (email?.[0] ?? "?").toUpperCase();
}

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openAuth } = useAuthUI();
  const { user, isAuthenticated } = useCurrentUser();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mockSignOut = useAuthStore((s) => s.signOut);
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  // Same sign-out as the Profile page's button: one click fires one request, the
  // local mirror is cleared even if the server call fails, and the cache is dropped.
  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } catch {
      // Already signed out, offline, or rate-limited — still clear locally.
    }
    mockSignOut();
    queryClient.clear();
    setIsSigningOut(false);
    navigate("/", { replace: true });
  }

  const isActive = (to: string) => location.pathname.startsWith(to);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/feed" className="flex items-center gap-2.5">
          <Seal className="h-8 w-8 text-primary" />
          <span className="font-display text-xl font-semibold tracking-tight text-foreground">
            AYE <span className="text-accent">&amp;</span> NAY
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive(item.to)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {isAuthenticated ? (
            <>
              <NotificationBell />
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  data-testid="account-menu"
                  aria-label="Account menu"
                  className="flex items-center gap-2 rounded-full outline-none ring-ring focus-visible:ring-2"
                >
                  <Avatar className="h-9 w-9 border border-border">
                    <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
                      {initials(user?.name, user?.email)}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">
                    {user?.name || "Citizen"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/profile")}>
                  <UserIcon className="mr-2 h-4 w-4" /> Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/saved")}>
                  <Bookmark className="mr-2 h-4 w-4" /> Saved posts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/voting-history")}>
                  <History className="mr-2 h-4 w-4" /> Voting history
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/trending")}>
                  <TrendingUp className="mr-2 h-4 w-4" /> Trending
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate("/settings")}>
                  <SettingsIcon className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button
              className="hidden md:inline-flex"
              onClick={() => openAuth()}
            >
              Sign up
            </Button>
          )}

          {/* Mobile menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <div className="mt-8 flex flex-col gap-1">
                {NAV.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileOpen(false)}
                    className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-secondary"
                  >
                    {item.label}
                  </Link>
                ))}
                {!isAuthenticated ? (
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setMobileOpen(false);
                      openAuth();
                    }}
                  >
                    Sign up / Sign in
                  </Button>
                ) : (
                  <>
                    <Link
                      to="/profile"
                      onClick={() => setMobileOpen(false)}
                      className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-secondary"
                    >
                      Profile
                    </Link>
                    <Link
                      to="/saved"
                      onClick={() => setMobileOpen(false)}
                      className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-secondary"
                    >
                      Saved posts
                    </Link>
                    <Link
                      to="/settings"
                      onClick={() => setMobileOpen(false)}
                      className="rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-secondary"
                    >
                      Settings
                    </Link>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setMobileOpen(false);
                        void handleSignOut();
                      }}
                    >
                      Sign out
                    </Button>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
