/**
 * A LINK THAT READS THE BUG QUEUE, AND NOTHING ELSE.
 *
 * WHY THIS EXISTS. The bug reporter is where the owner writes down what needs
 * fixing. Getting that list to whoever does the fixing meant signing into the
 * admin panel and copying it out by hand, every time, and so the queue became
 * a place reports went rather than a place they came from.
 *
 * The obvious shortcut is to hand over an admin password. That is the wrong
 * trade by a wide margin: it grants everything, to everything, forever, in
 * order to solve a problem that is reading one table. And a password shared
 * once cannot be un-shared — the only way back is to change it for everybody.
 *
 * So this is a CAPABILITY, not an account:
 *
 *   - It reads bug reports. There is no write path anywhere in this file.
 *   - It carries no identity. Nothing it can reach is scoped to a person, so
 *     there is nobody for it to impersonate.
 *   - It expires. A link with no expiry is a password with extra steps.
 *   - It can be revoked, on its own, without disturbing anything else.
 *   - Its use is counted and timestamped, so the owner can see it working and
 *     notice it working when it should not be.
 *
 * WHAT IS STORED. Not the token — only its SHA-256 digest, the same treatment
 * a B2B client's API key gets. This table leaking does not hand anybody a
 * working link. The plaintext exists in one response, once, and after that it
 * is the holder's problem.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";

/** How long a link lives unless the caller asks for something shorter. */
export const DEFAULT_TTL_DAYS = 30;
/** Nobody needs a year. A long-lived capability is the thing this avoids. */
export const MAX_TTL_DAYS = 90;

/** 48 bytes of CSPRNG, base64url — the same strength as an API key. */
function generateToken(): string {
  return randomBytes(48).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Enough to recognise a token in a list without being enough to use one.
 * Twelve hex characters of the digest: unique in practice among a handful of
 * links, and useless to anybody who does not already hold the token.
 */
function fingerprintOf(token: string): string {
  return hashToken(token).slice(0, 12);
}

export interface IssuedReadLink {
  id: string;
  /** THE ONLY TIME THIS IS EVER RETURNED. */
  token: string;
  label: string;
  fingerprint: string;
  expiresAt: Date;
}

/**
 * Mint a link. The plaintext token comes back exactly once, here, and is not
 * written to the database, the activity log, or anywhere else.
 */
export async function issueReadLink(input: {
  label: string;
  ttlDays?: number;
  createdById: string;
  createdBy: string;
}): Promise<IssuedReadLink> {
  const label = input.label.trim();
  if (!label) throw new Error("A link needs a label, so it can be recognised later and revoked");

  const ttl = Math.min(Math.max(input.ttlDays ?? DEFAULT_TTL_DAYS, 1), MAX_TTL_DAYS);
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttl * 24 * 60 * 60 * 1000);

  const row = await prisma.bugReportReadLink.create({
    data: {
      tokenHash: hashToken(token),
      label,
      fingerprint: fingerprintOf(token),
      createdById: input.createdById,
      createdBy: input.createdBy,
      expiresAt,
    },
  });

  return { id: row.id, token, label: row.label, fingerprint: row.fingerprint, expiresAt: row.expiresAt };
}

/**
 * Is this token a live link? Returns the row's id when it is, null otherwise.
 *
 * Every rejection returns the same null. A caller cannot tell "no such link"
 * from "revoked" from "expired", because the difference is only useful to
 * somebody guessing.
 *
 * The digest comparison is constant-time. The lookup itself is by unique index
 * on the digest, so a wrong token never reaches a comparison at all — this
 * guards the case where it does.
 */
export async function verifyReadLink(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;

  const digest = hashToken(token);
  const row = await prisma.bugReportReadLink.findUnique({ where: { tokenHash: digest } });
  if (!row) return null;

  const a = Buffer.from(row.tokenHash, "utf8");
  const b = Buffer.from(digest, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (row.revokedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;

  return row.id;
}

/**
 * Record a use. Deliberately not awaited by the read path's response — but it
 * IS awaited by the caller before returning, because a capability whose use is
 * not recorded is one nobody can audit, and "the request was fast" is not worth
 * that.
 */
export async function recordUse(id: string): Promise<void> {
  await prisma.bugReportReadLink.update({
    where: { id },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });
}

export interface ListedReadLink {
  id: string;
  label: string;
  fingerprint: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  lastUsedAt: Date | null;
  useCount: number;
  /** live | revoked | expired — computed here so the panel and this agree. */
  state: "live" | "revoked" | "expired";
}

/**
 * Every link ever issued, newest first.
 *
 * Revoked and expired rows are kept rather than deleted: a link that vanishes
 * takes its usage history with it, and "was this ever used, and when" is the
 * question somebody asks precisely when a link has gone wrong.
 */
export async function listReadLinks(): Promise<ListedReadLink[]> {
  const rows = await prisma.bugReportReadLink.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    fingerprint: row.fingerprint,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    lastUsedAt: row.lastUsedAt,
    useCount: row.useCount,
    state: row.revokedAt ? "revoked" : row.expiresAt.getTime() <= now ? "expired" : "live",
  }));
}

/**
 * Revoke one link. Idempotent: revoking an already-revoked link keeps the
 * first revocation's time and reporter, because that is when it stopped
 * working and overwriting it would lose the fact.
 */
export async function revokeReadLink(id: string, revokedBy: string): Promise<boolean> {
  const row = await prisma.bugReportReadLink.findUnique({ where: { id } });
  if (!row) return false;
  if (row.revokedAt) return true;

  await prisma.bugReportReadLink.update({
    where: { id },
    data: { revokedAt: new Date(), revokedBy },
  });
  return true;
}
