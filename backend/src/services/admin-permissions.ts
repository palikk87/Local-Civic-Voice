/**
 * Whether this administrator may do this particular thing.
 *
 * WHAT THIS REPLACES. Fourteen copies of `session.role !== "superadmin"`,
 * scattered through routes/admin.ts and routes/b2b.ts. Every one of them was a
 * policy decision written at the point of use, which meant the answer to "what
 * can a moderator do" could only be found by reading every route, and changing
 * it meant a deploy.
 *
 * SUPERADMIN IS THE OWNER, NOT A ROLE. It holds every capability, including
 * ones added after it was granted, and it is not stored in AdminRole so it
 * cannot be edited or deleted. That is not a special case for its own sake — it
 * is what makes every other role safe to change. Somebody has to be able to
 * undo a mistake, including the mistake of removing their own access, and if
 * that person's powers were themselves editable there would be a sequence of
 * legitimate edits that locks everybody out of the platform permanently.
 *
 * RESOLVED PER REQUEST, NOT COPIED INTO THE SESSION. AdminSession already
 * denormalises role for speed, and that is right for a label. It is wrong for
 * authorization: a role edited to remove a capability has to stop granting it
 * NOW, not whenever the holder next signs in. Taking away a permission that
 * keeps working for eight hours is not a permission system.
 *
 * The cost of that is one small query per privileged request, so it is cached
 * for a few seconds and the cache is dropped the moment a role is written.
 */

import { prisma } from "../prisma";
import {
  BUILT_IN_ROLES,
  CAPABILITY_KEYS,
  isCapability,
  type Capability,
} from "./admin-capabilities";

/** The slug that means "the owner". Never a row in AdminRole. */
export const OWNER_ROLE = "superadmin";

/**
 * How long a resolved role is trusted.
 *
 * Short enough that revoking a capability takes effect while somebody is still
 * looking at the screen they revoked it from; long enough that a burst of
 * requests from one console session is one query.
 */
const CACHE_MS = 5_000;

const cache = new Map<string, { capabilities: Set<string>; readAt: number }>();

/** Called after any write to a role, so nobody keeps a power that was just removed. */
export function forgetCachedRoles(): void {
  cache.clear();
}

/**
 * Every capability a role slug currently grants.
 *
 * An unknown slug grants nothing. That is deliberate and it is the safe
 * direction: a typo'd or deleted role means an administrator who can sign in
 * and do nothing, which is visible and fixable, rather than one who can do
 * everything, which is not.
 */
export async function capabilitiesFor(roleSlug: string): Promise<Set<string>> {
  if (roleSlug === OWNER_ROLE) return new Set(CAPABILITY_KEYS);

  const cached = cache.get(roleSlug);
  if (cached && Date.now() - cached.readAt < CACHE_MS) return cached.capabilities;

  const role = await prisma.adminRole
    .findUnique({ where: { slug: roleSlug }, select: { capabilities: true } })
    .catch(() => null);

  const capabilities = new Set<string>();
  if (role) {
    try {
      const parsed: unknown = JSON.parse(role.capabilities);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          // Only capabilities the code still knows about. A key left over from
          // a renamed capability grants nothing rather than something adjacent.
          if (typeof entry === "string" && isCapability(entry)) capabilities.add(entry);
        }
      }
    } catch {
      // A malformed row grants nothing. Same reasoning as an unknown slug.
    }
  } else {
    // NO ROW YET, BUT WE KNOW WHAT THIS ROLE IS.
    //
    // ensureBuiltInRoles() runs at boot and is not awaited before the server
    // starts answering, so for the first moments of a deploy the "admin" and
    // "moderator" rows may not exist. Falling through to an empty set there
    // means every administrator is refused everything, and then quietly starts
    // working — authorization that is wrong for a few seconds after each
    // deploy and leaves no trace of why. Caught by a maintenance test that
    // passed one assertion and failed the next with the same token.
    //
    // A built-in role with no row falls back to the seed it would have been
    // written with. The row still wins the moment it exists, so an owner's
    // edits are never overridden by this.
    const builtIn = BUILT_IN_ROLES.find((candidate) => candidate.slug === roleSlug);
    if (builtIn) {
      for (const key of builtIn.capabilities) capabilities.add(key);
      // NOT CACHED. This is a stand-in for a row that is about to appear, and
      // caching it would keep serving the seed for five seconds after the real
      // row — possibly an edited one — was written.
      return capabilities;
    }
  }

  cache.set(roleSlug, { capabilities, readAt: Date.now() });
  return capabilities;
}

/**
 * Every role slug that may sign into the admin console.
 *
 * The owner, plus whatever roles exist. Read fresh rather than cached: a role
 * created a moment ago must be able to sign in immediately, and this is on the
 * login path rather than on every request.
 *
 * The alternative — a literal list of role names in the login query — is what
 * shipped, and it meant the first custom role could be created and assigned and
 * still could not sign in.
 */
export async function consoleRoleSlugs(): Promise<string[]> {
  const roles = await prisma.adminRole
    .findMany({ select: { slug: true } })
    .catch(() => [] as { slug: string }[]);
  return [OWNER_ROLE, ...roles.map((role) => role.slug)];
}

export interface OwnerProtection {
  error: string;
}

/**
 * Refuse anything aimed AT the owner's account.
 *
 * THE RULE, IN KHALID'S WORDS: "no one else can be super admin and no one can
 * be above super admin or affect super admin access or any of its abilities."
 *
 * Without this, the permission system contained its own undoing. An
 * administrator holding `users.delete` — a capability an owner might hand out
 * for perfectly ordinary reasons — could delete the owner's account outright.
 * `users.ban` could lock them out. `users.resetPassword` could take the account
 * over. Every one of those is a legitimate power over ordinary accounts and a
 * catastrophe pointed at this one.
 *
 * So the owner's account is not administrable from inside the console at all,
 * by anybody, including the owner. Changing their own password, name or
 * anything else about themselves happens the way it does for every citizen —
 * through their own account, with their own password. What is closed here is
 * the ADMINISTRATIVE path, which is the one somebody else could walk.
 *
 * The seat is filled by scripts/seed-admin.ts, which needs a shell and a
 * database URL. That is the right bar for the one account nothing else can
 * touch.
 */
export async function protectOwner(targetUserId: string): Promise<OwnerProtection | null> {
  const target = await prisma.user
    .findUnique({ where: { id: targetUserId }, select: { role: true } })
    .catch(() => null);

  if (target?.role !== OWNER_ROLE) return null;
  return {
    error:
      "That is the owner account. It cannot be banned, deleted, re-keyed or re-roled from " +
      "the console by anybody — that is what makes every other permission here safe to grant.",
  };
}

/**
 * Whether the owner seat can be handed to anybody. It cannot.
 *
 * There is exactly one, it is not assignable, and no path through this API
 * creates a second. A role that could mint owners would be a role that could
 * take the platform, and "only an owner may do it" is not an answer — an owner
 * who is phished, or who mis-clicks, has then created somebody they cannot
 * remove.
 */
export const OWNER_SEAT_IS_ASSIGNABLE = false;

export async function can(roleSlug: string, capability: Capability): Promise<boolean> {
  return (await capabilitiesFor(roleSlug)).has(capability);
}

export interface CapabilityDenial {
  error: string;
}

/**
 * The guard every privileged route calls.
 *
 * Returns null when allowed, or the body to answer 403 with — naming the
 * capability, because "forbidden" sends somebody to ask an administrator what
 * they are missing and this sentence answers it.
 */
export async function requireCapability(
  roleSlug: string,
  capability: Capability,
): Promise<CapabilityDenial | null> {
  if (await can(roleSlug, capability)) return null;
  return {
    error: `Your role does not include "${capability}". Ask an owner to add it.`,
  };
}

/**
 * Make sure the built-in roles exist, without ever overwriting what somebody
 * has configured.
 *
 * ONLY CREATES, NEVER UPDATES. If a deployment has decided its moderators may
 * post announcements, a redeploy must not quietly take that back — a boot that
 * silently rewrites authorization is exactly the kind of surprise this codebase
 * has a rule against. New capabilities therefore do not appear on existing
 * roles by themselves, which is the conservative direction: they have to be
 * granted deliberately.
 */
export async function ensureBuiltInRoles(): Promise<void> {
  for (const role of BUILT_IN_ROLES) {
    const existing = await prisma.adminRole.findUnique({
      where: { slug: role.slug },
      select: { slug: true },
    });
    if (existing) continue;

    await prisma.adminRole.create({
      data: {
        slug: role.slug,
        name: role.name,
        description: role.description,
        capabilities: JSON.stringify(role.capabilities),
        builtIn: true,
      },
    });
    console.log(`[Roles] Created the built-in "${role.name}" role.`);
  }
  forgetCachedRoles();
}
