/**
 * THE ONLY PLACE A CREDENTIAL IS EVER WRITTEN.
 *
 * WHY THIS FILE EXISTS. A B2B client's password changed and nobody could say
 * what changed it. The answer turned out to be a seed script: it re-keyed every
 * account it touched on every run, so setting up the second login silently
 * rotated the first one's password out from under whoever was using it. The
 * admin seed had the identical shape. Neither recorded anything, so from the
 * outside a working login simply stopped working — which, to somebody paying
 * for the dashboard, is indistinguishable from a breach.
 *
 * A credential that can change without a trace is a credential nobody can trust,
 * and that is a product problem long before it is a security one. So:
 *
 *   1. EVERY change comes through this file. Nothing else in src/ or scripts/
 *      may hash a password or write passwordHash / apiKeyHash / Account.password
 *      — enforced by tests/credential-writes.test.ts, which reads the source and
 *      fails on a new writer the day it is added.
 *
 *   2. EVERY change is recorded before it is reported as done. The audit row is
 *      awaited, not fired and forgotten, so a command-line script cannot exit
 *      between the rotation and the record of it. If a credential ever changes
 *      again, the admin portal's activity log says who and why.
 *
 *   3. EVERY change has to be asked for in words. The caller supplies an actor
 *      and a reason, and neither has a default. A rotation nobody can name is a
 *      rotation nobody meant.
 *
 * WHAT THIS DOES NOT DO. It does not decide policy. Whether a seed script should
 * rotate on re-run is the script's business — and the answer, in both scripts,
 * is now no unless explicitly told to. This file makes the change traceable and
 * gives it one shape; it does not make it wise.
 */

import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../prisma";

// ---------------------------------------------------------------------------
// Who did it, and why
// ---------------------------------------------------------------------------

/**
 * The party responsible for a credential change.
 *
 * A union rather than a pair of strings so a caller cannot pass the reason in
 * the actor slot and end up with an audit row that names nobody.
 */
export type CredentialActor =
  | { kind: "admin"; adminId: string; username: string }
  /**
   * Somebody changing their own password. Recorded distinctly from an admin
   * doing it to them, because "I changed my password" and "somebody changed my
   * password" are different events and only one of them is alarming.
   */
  | { kind: "self"; userId: string; username: string }
  /**
   * A command-line run. `script` is the path, so the log names the tool.
   *
   * NOTE: no script in this repository rotates anything. Both seeds create and
   * leave existing credentials alone. This exists for the one honest case —
   * giving a credential to an account that has none, which nobody could sign in
   * to — and so that any future script is forced to identify itself.
   */
  | { kind: "cli"; script: string };

export interface CredentialChange {
  actor: CredentialActor;
  /**
   * Recorded verbatim in the activity log. Required and non-empty — the whole
   * point is that a future reader can find out why this happened.
   */
  reason: string;
}

function actorFields(actor: CredentialActor): { adminId: string; adminUsername: string } {
  switch (actor.kind) {
    case "admin":
      return { adminId: actor.adminId, adminUsername: actor.username };
    case "self":
      // Prefixed so it can never be mistaken for an administrator acting on
      // somebody. The person and the operator both need to be able to tell
      // those apart at a glance.
      return { adminId: actor.userId, adminUsername: `self:${actor.username}` };
    case "cli":
      // Deliberately not a real admin id. A change made from a shell was not
      // made by an account, and recording it as one would be a lie in the very
      // log that exists to prevent lies.
      return { adminId: "cli", adminUsername: `cli:${actor.script}` };
  }
}

/**
 * Write the audit row, and wait for it.
 *
 * The admin console's own createActivityLog is fire-and-forget, which is right
 * for a long-lived server answering a request. It is wrong here: `bun run
 * scripts/seed-b2b.ts` calls process.exit the moment main() resolves, and an
 * unawaited insert dies with the process. The one rotation most likely to
 * surprise somebody later would be the one least likely to be recorded.
 */
async function record(
  action: string,
  change: CredentialChange,
  targetId: string,
  details: string
): Promise<void> {
  const { adminId, adminUsername } = actorFields(change.actor);
  await prisma.adminActivityLog.create({
    data: {
      action,
      adminId,
      adminUsername,
      targetType: "system",
      targetId,
      details: `${details} — ${change.reason}`,
    },
  });
}

function requireReason(change: CredentialChange): void {
  if (!change.reason.trim()) {
    throw new Error(
      "A credential change needs a reason. It is written to the activity log, " +
        "and it is the only thing that will explain this to whoever finds it later."
    );
  }
}

// ---------------------------------------------------------------------------
// Secret material
// ---------------------------------------------------------------------------

/**
 * SHA-256, no key stretching, on purpose.
 *
 * An API key is looked up by its digest — findUnique({ where: { apiKeyHash } })
 * — and a KDF cannot be looked up. That trade is only sound for a value with
 * real entropy, which is why generateApiKey exists and why the seed script warns
 * about short ones. Must match hashApiKey() in routes/b2b.ts, which reads it.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/** 48 bytes of CSPRNG, base64url. The strength `openssl rand -base64 48` gives. */
export function generateApiKey(): string {
  return randomBytes(48).toString("base64url");
}

/** A generated password, for when the caller does not supply one. */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

// ---------------------------------------------------------------------------
// B2B clients
// ---------------------------------------------------------------------------

export interface NewB2BClient {
  username: string;
  name: string;
  type: string;
  tier: string;
  password: string;
  apiKey: string;
  /**
   * The citizen account this business account is being created for, when it is
   * being created by converting one. Omitted for a client minted from nothing.
   *
   * A LINK, NOT A TRANSFORMATION: the citizen account is not touched, not
   * consumed, and not given a role. See routes/admin.ts.
   */
  userId?: string;
}

/** Everything about a client except its secrets. */
export const B2B_PUBLIC_FIELDS = {
  id: true,
  username: true,
  name: true,
  type: true,
  tier: true,
  lastAccessAt: true,
  createdAt: true,
  updatedAt: true,
  /** Null unless this account was converted from a citizen account. */
  userId: true,
} as const;

export type B2BPublicRow = {
  id: string;
  username: string;
  userId?: string | null;
  name: string;
  type: string;
  tier: string;
  lastAccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Create a business account. Fails if the username is taken. */
export async function createB2BClient(
  input: NewB2BClient,
  change: CredentialChange
): Promise<B2BPublicRow> {
  requireReason(change);

  const created = await prisma.b2BClient.create({
    data: {
      // Stored lowercased; routes/b2b.ts lowercases before matching, so the
      // login stays case-insensitive.
      username: input.username.toLowerCase(),
      name: input.name,
      type: input.type,
      tier: input.tier,
      passwordHash: await hashPassword(input.password),
      apiKeyHash: hashApiKey(input.apiKey),
      ...(input.userId ? { userId: input.userId } : {}),
    },
    select: B2B_PUBLIC_FIELDS,
  });

  await record(
    "create_b2b_client",
    change,
    created.id,
    input.userId
      ? `Created B2B client ${created.username} from an existing account`
      : `Created B2B client ${created.username}`,
  );

  return created;
}

export interface B2BRotation {
  /** Omit to leave the password alone. */
  password?: string;
  /** Omit to leave the API key alone. */
  apiKey?: string;
}

export interface B2BRotationResult {
  client: B2BPublicRow;
  passwordChanged: boolean;
  apiKeyChanged: boolean;
  /** Live sessions ended, which only happens when the password moved. */
  revokedSessions: number;
}

/**
 * Change an existing client's password, API key, or both.
 *
 * Rotating a password revokes the sessions it opened. That is done here rather
 * than at each call site because leaving them alive means a rotation prompted by
 * a leak changes nothing for as long as the stolen session lasts — and a caller
 * who forgot that step would have no way to know.
 */
export async function rotateB2BCredentials(
  clientId: string,
  next: B2BRotation,
  change: CredentialChange
): Promise<B2BRotationResult> {
  requireReason(change);

  if (next.password === undefined && next.apiKey === undefined) {
    throw new Error("rotateB2BCredentials was asked to change nothing.");
  }

  const data: { passwordHash?: string; apiKeyHash?: string } = {};
  if (next.password !== undefined) data.passwordHash = await hashPassword(next.password);
  if (next.apiKey !== undefined) data.apiKeyHash = hashApiKey(next.apiKey);

  const client = await prisma.b2BClient.update({
    where: { id: clientId },
    data,
    select: B2B_PUBLIC_FIELDS,
  });

  let revokedSessions = 0;
  if (next.password !== undefined) {
    revokedSessions = (await prisma.b2BSession.deleteMany({ where: { clientId } })).count;
  }

  const changed = [next.password !== undefined && "password", next.apiKey !== undefined && "API key"]
    .filter(Boolean)
    .join(" and ");

  await record(
    "rotate_b2b_client",
    change,
    clientId,
    `Rotated ${changed} for B2B client ${client.username}`
  );

  return {
    client,
    passwordChanged: next.password !== undefined,
    apiKeyChanged: next.apiKey !== undefined,
    revokedSessions,
  };
}

// ---------------------------------------------------------------------------
// B2B seats
// ---------------------------------------------------------------------------

/**
 * A seat is a person at a client company. It carries its own password, so it
 * comes through this file like every other credential in the system.
 *
 * WHY SEATS AT ALL. One B2BClient row used to be the entire account: one
 * username, one password, shared by everybody at the firm. Withdrawing one
 * person's access meant changing the password on all of them — which is the
 * very event, a login that stopped working with no explanation, that this file
 * was written to make impossible. A seat can be disabled on its own.
 */
export interface NewB2BMember {
  clientId: string;
  username: string;
  name: string;
  email?: string | null;
  /** owner | admin | analyst */
  role: string;
  password: string;
}

export const B2B_MEMBER_PUBLIC_FIELDS = {
  id: true,
  clientId: true,
  username: true,
  name: true,
  email: true,
  role: true,
  disabled: true,
  lastAccessAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type B2BMemberPublicRow = {
  id: string;
  clientId: string;
  username: string;
  name: string;
  email: string | null;
  role: string;
  disabled: boolean;
  lastAccessAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Add a seat. Fails if the username is taken by any client's seat. */
export async function createB2BMember(
  input: NewB2BMember,
  change: CredentialChange
): Promise<B2BMemberPublicRow> {
  requireReason(change);

  const created = await prisma.b2BMember.create({
    data: {
      clientId: input.clientId,
      // Lowercased on the way in, matched lowercased at login — same rule as
      // B2BClient.username, because both are typed into the same box.
      username: input.username.toLowerCase(),
      name: input.name,
      email: input.email ?? null,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
    select: B2B_MEMBER_PUBLIC_FIELDS,
  });

  await record(
    "create_b2b_member",
    change,
    created.clientId,
    `Added B2B seat ${created.username} (${created.role})`
  );

  return created;
}

export interface B2BMemberPasswordResult {
  member: B2BMemberPublicRow;
  /** Live sessions ended for this seat. Always, on any password change. */
  revokedSessions: number;
}

/**
 * Set a seat's password.
 *
 * Revokes that seat's sessions and no one else's. The whole point of a seat is
 * that what happens to it happens to one person, so this deletes by memberId
 * rather than by clientId — signing the entire company out because one analyst
 * changed their password would reintroduce the shared-credential problem in a
 * different costume.
 */
export async function setB2BMemberPassword(
  memberId: string,
  password: string,
  change: CredentialChange
): Promise<B2BMemberPasswordResult> {
  requireReason(change);

  const member = await prisma.b2BMember.update({
    where: { id: memberId },
    data: { passwordHash: await hashPassword(password) },
    select: B2B_MEMBER_PUBLIC_FIELDS,
  });

  const revokedSessions = (await prisma.b2BSession.deleteMany({ where: { memberId } })).count;

  await record(
    "set_b2b_member_password",
    change,
    member.clientId,
    `Set the password on B2B seat ${member.username}`
  );

  return { member, revokedSessions };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Set the password on a person's account.
 *
 * Better Auth keeps a citizen's password on the Account row with
 * providerId "credential", not on User — the admin console verifies against
 * exactly the same row an ordinary sign-in does, so there is one password per
 * person and no separate admin credential store.
 *
 * Only reached by scripts/seed-admin.ts today. The self-service reset flow does
 * not come through here: that one is initiated by the person themselves, with a
 * code sent to their own inbox, and Better Auth owns it end to end.
 */
export async function setUserPassword(
  userId: string,
  password: string,
  change: CredentialChange,
  options: {
    revokeSessions?: boolean;
    /**
     * One session to spare. Somebody changing their own password should end
     * every OTHER session, not the one they are typing on — being signed out by
     * the act of securing your account reads as the change having broken
     * something.
     */
    keepSessionId?: string;
  } = {}
): Promise<{ created: boolean; revokedSessions: number }> {
  requireReason(change);

  const hash = await hashPassword(password);

  const credential = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { id: true },
  });

  if (credential) {
    await prisma.account.update({ where: { id: credential.id }, data: { password: hash } });
  } else {
    await prisma.account.create({
      data: { userId, accountId: userId, providerId: "credential", password: hash },
    });
  }

  // Ending the old sessions is the caller's call, and the two cases differ.
  // An admin resetting somebody else's password is usually responding to a
  // compromise, and leaving the attacker's session alive would make the reset
  // pointless. Somebody changing their own password on their own laptop is not
  // asking to be signed out of it.
  let revokedSessions = 0;
  if (options.revokeSessions) {
    revokedSessions = (
      await prisma.session.deleteMany({
        where: {
          userId,
          ...(options.keepSessionId ? { id: { not: options.keepSessionId } } : {}),
        },
      })
    ).count;
  }

  await record(
    credential ? "rotate_user_password" : "set_user_password",
    change,
    userId,
    credential
      ? `Rotated the password for user ${userId}` +
          (options.revokeSessions ? `, ending ${revokedSessions} session(s)` : "")
      : `Set a password for user ${userId} (no credential row existed)`
  );

  return { created: !credential, revokedSessions };
}
