import type { ReactNode } from "react";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
import { JuryGate } from "@/components/jury/JuryGate";
import { BugReporter } from "@/components/support/BugReporter";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Home,
  Compass,
  BookOpen,
  User,
  Users,
  Landmark,
  LogOut,
  Newspaper,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { Seal } from "@/components/civic/Seal";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useCurrentUser, useAuthUI, usePermissions } from "@/hooks/use-civic-auth";
import type { Capability } from "@/lib/permissions";
import { signOut } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { publicHandle } from "@/lib/public-identity";

interface NavItem {
  to: string;
  label: string;
  /**
   * What the PHONE bar says, when the full word does not fit in an eighth of a
   * phone. The sidebar always uses `label`. Omitted means the two are the same.
   */
  shortLabel?: string;
  icon: LucideIcon;
  /** Omitted = public. Set = only shown to visitors who hold this capability. */
  capability?: Capability;
}

/**
 * SHORT LABELS FOR THE PHONE BAR.
 *
 * Signed in there are EIGHT tabs, and eight across a 393px phone leaves each
 * label 45px. Measured: "Government" needs 60px and "Messages" needs 52px, so
 * both were rendering as "Govern…" and "Messa…" on every phone. On an iPhone SE
 * the budget is 36px and "Timeline" and "Discover" went too.
 *
 * The truncation itself was deliberate and stays — the label gives way before
 * the layout does, because the alternative was Safari zooming the whole page
 * out. But a signpost you cannot read is not doing its job either, and
 * "Govern…" is not a word.
 *
 * So the two long ones get a shorter form used ONLY in the phone bar. The
 * sidebar has room and keeps the full word, which is the one that has to be
 * unambiguous. The icon carries the rest of the meaning in the bar.
 *
 * phone-fit-check measures this now, signed IN — it only ever ran signed out,
 * which is a five-tab nav, which is why it passed for as long as it existed.
 */
const NAV: NavItem[] = [
  { to: "/feed", label: "Public Square", shortLabel: "Square", icon: Home },
  { to: "/timeline", label: "Timeline", icon: Newspaper, capability: "viewTimeline" },
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/people", label: "Citizens", icon: Users },
  {
    to: "/messages",
    label: "Messages",
    shortLabel: "Inbox",
    icon: MessageCircle,
    capability: "viewMessages",
  },
  { to: "/government", label: "Government", shortLabel: "Gov", icon: Landmark },
  // "My record" used to sit here. It is on the profile now — where you stood
  // is not a separate destination from who you are, and having it as one meant
  // a profile could be read without ever seeing a single position.
  { to: "/profile", label: "Profile", icon: User, capability: "viewProfile" },
];

function isActive(pathname: string, to: string): boolean {
  if (to === "/feed") return pathname === "/feed" || pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function initialsOf(name: string | null | undefined, email: string | null | undefined): string {
  const base = (name || email || "?").trim();
  return base
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function AppShell({
  children,
  rightRail,
  wide = false,
}: {
  children: ReactNode;
  rightRail?: ReactNode;
  wide?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const { can } = usePermissions();

  // Guests don't see links to member-only pages (timeline, profile).
  const visibleNav = NAV.filter((item) => !item.capability || can(item.capability));

  const displayName = user?.name || "Citizen";
  // Their chosen name, never the email. This line used to greet people with
  // the distinctive half of their own address, in the sidebar, on every page.
  const handle = publicHandle(user) ? `@${publicHandle(user)}` : "";
  const initials = initialsOf(user?.name, user?.email);

  async function handleSignOut() {
    await signOut();
    await queryClient.invalidateQueries();
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen">
      {/* A gate with no sign on it is indistinguishable from a broken app.
          Renders nothing unless the reader is signed in and unverified. */}
      <VerifyEmailBanner />
      {/* ARTICLE IV. A summons puts a banner here; an accepted summons takes
          them to the case and keeps them there. The server enforces it either
          way — this is so the app behaves like it means it. */}
      <JuryGate />

      {/* ---------- Desktop left sidebar ---------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-background/80 px-3 py-5 backdrop-blur lg:flex">
        <Link to="/feed" className="flex items-center gap-2.5 px-2">
          <Seal className="h-8 w-8 text-accent" />
          <span className="font-display text-lg font-semibold tracking-tight text-foreground">
            AYE <span className="text-accent">&amp;</span> NAY
          </span>
        </Link>

        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {visibleNav.map((item) => {
            const active = isActive(location.pathname, item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent/15 text-accent"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {active ? (
                  <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-accent" />
                ) : null}
                <Icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User card / sign in */}
        <div className="mt-auto border-t border-border pt-3">
          {isAuthenticated && user ? (
            <div className="flex items-center gap-2 rounded-xl p-2">
              <Avatar className="h-9 w-9 border border-border">
                {user.image ? <AvatarImage src={user.image} alt={displayName} /> : null}
                <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{handle}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={handleSignOut}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={() => openAuth()}>
              Sign in
            </Button>
          )}
        </div>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/feed" className="flex items-center gap-2">
          <Seal className="h-7 w-7 text-accent" />
          <span className="font-display text-base font-semibold tracking-tight text-foreground">
            AYE <span className="text-accent">&amp;</span> NAY
          </span>
        </Link>
        {isAuthenticated && user ? (
          <Link to="/profile" aria-label="Profile">
            <Avatar className="h-8 w-8 border border-border">
              {user.image ? <AvatarImage src={user.image} alt={displayName} /> : null}
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
          </Link>
        ) : (
          <Button size="sm" onClick={() => openAuth()}>
            Sign in
          </Button>
        )}
      </header>

      {/* ---------- Main content ---------- */}
      <div className="lg:pl-60">
        <div
          className={cn(
            "mx-auto flex gap-8 px-4 pb-20 pt-4 sm:px-6 lg:pb-10 lg:pt-8",
            wide ? "max-w-6xl" : "max-w-[calc(640px+300px+2rem)] xl:justify-center",
          )}
        >
          <main className={cn("min-w-0 flex-1", wide ? "" : "max-w-[640px] xl:mx-auto")}>
            {children}
          </main>

          {rightRail && !wide ? (
            <aside className="hidden w-[300px] shrink-0 xl:block">
              <div className="sticky top-8 space-y-5">{rightRail}</div>
            </aside>
          ) : null}
        </div>
      </div>

      {/* On every page, because the page somebody cannot get past is exactly
          the one they need to report from. */}
      <BugReporter />

      {/* ---------- Mobile bottom tab bar ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background/80 backdrop-blur lg:hidden">
        {visibleNav.map((item) => {
          const active = isActive(location.pathname, item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                // min-w-0 IS THE FIX, NOT A TIDY-UP. A flex item defaults to
                // min-width:auto, which means it refuses to shrink below the
                // width of its own text. With eight tabs on a phone, "Government"
                // and "Messages" would not give ground, the row grew wider than
                // the screen, and Safari zoomed the WHOLE PAGE out to fit it —
                // which is why the app arrived shrunken with the layout no
                // longer lining up with what was painted behind it.
                "flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center",
                // MEASURED, not chosen by eye. Eight tabs on a 320px iPhone SE
                // leave 40px each. "Discover" and "Timeline" need 42px at 10px
                // and were still being cut after the two long words got short
                // forms. At 9px they need ~38px and fit with room.
                //
                // The padding goes to zero rather than the type going smaller
                // still: the tap target is the whole flex item, so nothing gets
                // harder to hit — only the gap between labels closes up.
                //
                // 9px only below sm, where the bar is the only navigation. The
                // sidebar takes over above it and keeps the full words.
                "gap-0.5 px-0 py-2 text-[9px] font-medium leading-none transition-colors sm:px-0.5 sm:text-[10px]",
                active ? "text-accent" : "text-muted-foreground",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {/* The label still gives way before the layout does — but it
                  should not have to. See the note on NAV: the two long words
                  have a short form here so the bar reads as words rather than
                  as "Govern…" and "Messa…". */}
              <span className="w-full truncate text-center">
                {item.shortLabel ?? item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
