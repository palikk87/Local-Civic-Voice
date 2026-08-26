/**
 * What an administrator can be allowed to do, named once.
 *
 * WHY A CATALOGUE AND NOT FREE TEXT. A permission system whose permissions are
 * typed in by hand is a list of adjectives: somebody creates a role called
 * "Content Editor" with a permission called "edit_content", nothing anywhere
 * checks for that string, and the role does nothing at all while looking like
 * it does everything. That is worse than no permission system, because it is
 * believed.
 *
 * So every capability in this file is a literal that at least one route checks
 * by name. A role is built by ticking things from this list, never by inventing
 * one — and tests/admin-permissions.test.ts calls the endpoint behind every
 * capability with a role that lacks it, so a capability that stops gating
 * anything fails the suite rather than quietly becoming decoration.
 *
 * THE THREE THAT ARE NOT HERE. Reading the console, seeing that it exists, and
 * signing into it are not capabilities — they are what having any admin role at
 * all means. Gating them would allow a role that can sign in and see nothing,
 * which is a support ticket rather than a security boundary.
 */

export interface CapabilityDefinition {
  key: string;
  /** What it says on the checkbox. */
  label: string;
  /** Plain sentence: what somebody holding this can actually do. */
  grants: string;
  /** Grouping in the panel. */
  group: "People" | "Content" | "Business accounts" | "Platform";
  /**
   * True when handing this out is effectively handing over the platform.
   * Shown with a warning in the panel; still assignable, because refusing to
   * let the owner delegate their own authority is a different kind of wrong.
   */
  severe?: boolean;
}

export const CAPABILITIES = [
  // ---- People ----
  {
    key: "users.view",
    label: "View accounts",
    grants: "See the user list, search it, and open an account's detail.",
    group: "People",
  },
  {
    key: "users.ban",
    label: "Ban and unban",
    grants: "Suspend an account, with a reason, for a period or permanently.",
    group: "People",
  },
  {
    key: "users.resetPassword",
    label: "Reset a password",
    grants: "Set a new password on somebody's account and end their sessions.",
    group: "People",
    severe: true,
  },
  {
    key: "users.delete",
    label: "Delete an account",
    grants: "Permanently remove an account, its posts and its votes.",
    group: "People",
    severe: true,
  },
  {
    key: "users.assignRole",
    label: "Assign roles",
    grants:
      "Give an account an administrative role, or take one away. Anybody with " +
      "this can grant themselves anything.",
    group: "People",
    severe: true,
  },
  {
    key: "roles.manage",
    label: "Create and edit roles",
    grants: "Define what each role is allowed to do. Same reach as assigning them.",
    group: "People",
    severe: true,
  },

  // ---- Content ----
  {
    key: "posts.moderate",
    label: "Moderate posts",
    grants: "Remove posts and act on what people report.",
    group: "Content",
  },
  {
    key: "bugReports.manage",
    label: "Handle bug reports",
    grants: "Read the bug inbox and mark reports acknowledged, fixed or declined.",
    group: "Content",
  },
  {
    key: "announcements.write",
    label: "Post announcements",
    grants: "Publish a message that every citizen sees.",
    group: "Content",
  },
  {
    key: "merges.decide",
    label: "Decide law merges",
    grants:
      "Approve or reject merging two records of the same law. A wrong merge " +
      "moves real votes between records.",
    group: "Content",
  },
  {
    key: "content.repair",
    label: "Run content repairs",
    grants:
      "Re-pull official text, clear text that turned out to be a block page, " +
      "and backfill the executive-order archive.",
    group: "Content",
  },

  // ---- Business accounts ----
  {
    key: "b2b.view",
    label: "View business accounts",
    grants: "See which businesses have accounts and what tier they hold.",
    group: "Business accounts",
  },
  {
    key: "b2b.manage",
    label: "Manage business accounts",
    grants: "Create, retier, rotate credentials for and delete business accounts.",
    group: "Business accounts",
    severe: true,
  },

  // ---- Platform ----
  {
    key: "logs.view",
    label: "Read the activity log",
    grants: "See what every administrator has done and when.",
    group: "Platform",
  },
  {
    key: "analytics.view",
    label: "View platform analytics",
    grants: "See platform-wide counts and the dashboard.",
    group: "Platform",
  },
  {
    key: "keys.manage",
    label: "Manage API keys",
    grants:
      "Store, replace and clear the platform's provider keys. Holding this " +
      "means holding the platform's credentials.",
    group: "Platform",
    severe: true,
  },
  {
    key: "email.test",
    label: "Send a test email",
    grants: "Send a message from the platform's address to an address you choose.",
    group: "Platform",
  },
] as const satisfies readonly CapabilityDefinition[];

export type Capability = (typeof CAPABILITIES)[number]["key"];

export const CAPABILITY_KEYS: readonly Capability[] = CAPABILITIES.map((c) => c.key);

export function isCapability(value: string): value is Capability {
  return (CAPABILITY_KEYS as readonly string[]).includes(value);
}

/**
 * The roles that exist before anybody configures anything.
 *
 * `superadmin` is not in this list and is not stored as a row: it is not a
 * permission set, it is the owner. See services/admin-permissions.ts.
 */
export const BUILT_IN_ROLES: {
  slug: string;
  name: string;
  description: string;
  capabilities: Capability[];
}[] = [
  {
    slug: "admin",
    name: "Administrator",
    description:
      "Runs the platform day to day. Everything except handing out authority, " +
      "holding the platform's credentials, and deleting accounts.",
    capabilities: [
      "users.view",
      "users.ban",
      "posts.moderate",
      "bugReports.manage",
      "announcements.write",
      // ONE CAPABILITY FOR ONE ACT.
      //
      // Merging by hand and approving a queued merge do exactly the same thing
      // to the data — they rewrite which record every affected post and vote
      // belongs to. The code used to guard them differently: the direct route
      // let an admin OR a moderator merge, while the queue's approve demanded
      // a superadmin. So a moderator could do by hand what they were refused
      // through the reviewed path, which is backwards. They are one capability
      // now, and an owner who wants merges reserved to themselves unticks it.
      "merges.decide",
      "content.repair",
      "b2b.view",
      "logs.view",
      "analytics.view",
      "email.test",
    ],
  },
  {
    slug: "moderator",
    name: "Moderator",
    description: "Looks after what people post and what they report about each other.",
    capabilities: ["users.view", "users.ban", "posts.moderate", "bugReports.manage"],
  },
];
