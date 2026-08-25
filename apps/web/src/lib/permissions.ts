/**
 * Three-tier permission model.
 *
 *   guest  — not signed in. Can READ public civic records (feed, discover, bills,
 *            executive orders, Supreme Court cases, reference documents, people,
 *            representatives). Cannot participate and cannot see anything personal.
 *   user   — signed in with a citizen account. Everything a guest can do, plus
 *            participation (vote, comment, share, post, like, follow, delegate) and
 *            their own personal pages (timeline, profile, notifications, saved,
 *            settings, voting history, delegates).
 *   admin  — holds a valid ADMIN CONSOLE session. This is a separate login from the
 *            citizen session (POST /api/admin/login → bearer token), with its own
 *            roles: admin | moderator | superadmin. A normal signed-in citizen is
 *            NOT an admin. See lib/mobile/admin-store.ts.
 *
 * The backend is the real enforcement point — every write endpoint checks the citizen
 * session and every /api/admin/* route checks the admin token, independently of this
 * file. This module exists so the UI can prompt instead of silently failing.
 */

export type Role = "guest" | "user" | "admin";

/** Rank for "at least this tier" comparisons. */
const RANK: Record<Role, number> = {
  guest: 0,
  user: 1,
  admin: 2,
};

export function atLeast(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required];
}

/** Everything a person can try to do that we gate. */
export type Capability =
  // participation — writes to shared civic data
  | "vote"
  | "comment"
  | "post"
  | "like"
  | "share"
  | "follow"
  | "delegate"
  | "bookmark"
  | "moderate" // report / block / mute
  // personal surfaces — someone's own account data
  | "viewTimeline"
  | "viewProfile"
  | "viewNotifications"
  | "viewSaved"
  | "viewSettings"
  | "viewVotingHistory"
  | "viewDelegates"
  | "viewMessages"
  // administration
  | "viewAdmin";

/** Minimum tier each capability requires. */
const REQUIRED: Record<Capability, Role> = {
  vote: "user",
  comment: "user",
  post: "user",
  like: "user",
  share: "user",
  follow: "user",
  delegate: "user",
  bookmark: "user",
  moderate: "user",

  viewTimeline: "user",
  viewProfile: "user",
  viewNotifications: "user",
  viewSaved: "user",
  viewSettings: "user",
  viewVotingHistory: "user",
  viewDelegates: "user",
  viewMessages: "user",

  viewAdmin: "admin",
};

export function can(role: Role, capability: Capability): boolean {
  return atLeast(role, REQUIRED[capability]);
}

export function requiredRoleFor(capability: Capability): Role {
  return REQUIRED[capability];
}

/**
 * Resolve the current tier.
 *
 * `isAdmin` comes from the admin console session, NOT from the citizen session —
 * the two logins are independent, so an admin browsing while signed out of the
 * console is just a `user` (or `guest`).
 */
export function resolveRole(opts: { isSignedIn: boolean; isAdmin: boolean }): Role {
  if (opts.isAdmin) return "admin";
  return opts.isSignedIn ? "user" : "guest";
}

/**
 * Staff roles, as stored on the citizen's own User row.
 *
 * WHY THIS IS READ FROM THE ACCOUNT AND NOT FROM THE ADMIN-CONSOLE STORE.
 * The profile page used to advertise the Admin Console and the B2B portal
 * whenever a persisted `isAdminAuthenticated` flag was set. That flag lives in
 * localStorage, is written when somebody signs into the console, and is never
 * reconciled against the citizen account in front of it — so once anybody had
 * used the console in a browser, every later visitor to that browser was shown
 * both entry points, including after the admin's token had expired and after
 * they had signed out and somebody else had signed in.
 *
 * The cards never granted access — both portals have their own login — but
 * advertising a door is how somebody learns to go and knock on it, and telling
 * an ordinary citizen that this is their console is simply wrong.
 *
 * The account's role comes from the server on every session read, is scoped to
 * the person actually signed in, and disappears the moment they sign out.
 */
const STAFF_ROLES = new Set(["admin", "moderator", "superadmin"]);

export function isStaffAccount(user: { role?: string | null } | null | undefined): boolean {
  return !!user?.role && STAFF_ROLES.has(user.role.toLowerCase());
}
