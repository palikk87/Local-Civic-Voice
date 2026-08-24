/**
 * Creates or repairs the super-admin account.
 *
 * The admin console has no separate credential store: `routes/admin.ts` verifies
 * against the same User row and the same Better Auth password hash as an
 * ordinary sign-in, and grants access only when `role` is
 * admin | moderator | superadmin. So "setting the admin login" means creating
 * that user, setting its role, and setting its password — which is all this
 * script does.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT. They used to be constants in this file,
 * the password in plaintext, in a public repository — which made the super-admin
 * credential for a live app with real users readable by anyone who found it.
 * Never put a password back in this file.
 *
 * Usage — set the variables in your shell, not in a committed file:
 *
 *   ADMIN_USERNAME=palikk87 \
 *   ADMIN_EMAIL=palikk87@civicvoice.app \
 *   ADMIN_PASSWORD='…' \
 *   bun run scripts/seed-admin.ts
 *
 * THIS SCRIPT CREATES. IT NEVER CHANGES AN EXISTING PASSWORD.
 *
 * It used to rewrite the password on every run, so running it to correct a
 * username or repair a role silently re-keyed the super-admin — a working login
 * that stopped working for no visible reason, with nothing recorded anywhere.
 * The B2B seed had the identical shape, and that is what produced a B2B password
 * change nobody could account for.
 *
 * The rule now is absolute: no backend process re-keys anybody. A missing
 * account is created; an existing one has its role, username and display name
 * refreshed and its password left alone. There is no flag and no override,
 * because an override is a thing that gets used at 2am by somebody who has not
 * read this comment.
 *
 * CHANGING A PASSWORD IS A PERSON'S DECISION, MADE WHERE IT LEAVES A NAME:
 *
 *   The admin themselves  →  Settings → Change password, while signed in, or
 *                            "Forgot password" with a code to their own inbox.
 *                            The admin console verifies against the same User
 *                            row an ordinary sign-in does, so both work for it.
 *
 *   A super admin, for    →  POST /api/admin/users/:id/reset-password
 *   somebody else            Records who did it, and ends that person's
 *                            sessions.
 *
 * THE ONE EXCEPTION, and it is not a reset. An account with no credential row
 * cannot be signed in to by anybody; giving it one takes nothing away from
 * anyone and is the only way to recover a super-admin created by an older bug.
 * That case is handled, recorded, and announced when it happens.
 *
 * Enforced by tests/credential-writes.test.ts, which fails if a rotation path
 * reappears in this file.
 */
import { auth } from "../src/auth";
import { prisma } from "../src/prisma";
import { setUserPassword } from "../src/services/credentials";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME || ADMIN_USERNAME;

function requireEnv(): void {
  const missing = [
    !ADMIN_EMAIL && "ADMIN_EMAIL",
    !ADMIN_USERNAME && "ADMIN_USERNAME",
    !ADMIN_PASSWORD && "ADMIN_PASSWORD",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("See the usage comment at the top of this file.");
    process.exit(1);
  }
}

/**
 * Advisory only. This account can ban users, delete posts, and read the audit
 * log, so a weak password on it is worth one line of friction.
 */
function warnIfWeak(password: string): void {
  const problems = [
    password.length < 12 && "shorter than 12 characters",
    !/[^A-Za-z0-9]/.test(password) && "no symbols",
    !/[0-9]/.test(password) && "no digits",
    !/[A-Z]/.test(password) && "no uppercase letters",
  ].filter(Boolean);

  if (problems.length) {
    console.warn(`⚠️  Weak admin password (${problems.join(", ")}).`);
    console.warn("   This account can ban users and delete content.");
  }
}

const ACTOR = { kind: "cli", script: "scripts/seed-admin.ts" } as const;

async function main(): Promise<void> {
  requireEnv();
  const email = ADMIN_EMAIL as string;
  const username = ADMIN_USERNAME as string;
  const password = ADMIN_PASSWORD as string;
  const name = ADMIN_NAME ?? username;

  warnIfWeak(password);

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    include: { accounts: { where: { providerId: "credential" }, select: { id: true } } },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "superadmin", username, name },
    });

    console.log(`Updated super admin. id=${existing.id} username=${username} role=superadmin`);

    const credential = existing.accounts[0];

    // An account with no credential row cannot be signed in to at all, so
    // setting a password there is a repair rather than a rotation — nothing is
    // taken away from anyone. That is the one case this does without being
    // asked, and it says so.
    if (!credential) {
      await setUserPassword(existing.id, password, {
        actor: ACTOR,
        reason: "The account had no credential row, so nobody could sign in to it",
      });
      console.log("Password set (no credential row existed). Recorded in the activity log.");
      return;
    }

    console.log("Password untouched — this script does not change one that works.");
    console.log(
      "  To change it: sign in and use Settings → Change password, or 'Forgot password'."
    );
    return;
  }

  // New account: go through Better Auth so hashing and the Account row are
  // created exactly as a real signup would.
  await auth.api.signUpEmail({ body: { email, password, name } });

  const user = await prisma.user.update({
    where: { email },
    data: {
      role: "superadmin",
      username,
      // Constitution Article I, Section 3 gates every write to the public
      // record on a verified account. This one is created by the operator from
      // the command line, so there is no signup flow to send a code through.
      emailVerified: true,
    },
  });

  console.log(`Created super admin. id=${user.id} username=${user.username} role=${user.role}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
