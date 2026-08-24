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
 * SAFE TO RE-RUN, AND IT WILL NOT CHANGE THE PASSWORD YOU DID NOT ASK IT TO.
 *
 * It used to. Every run rewrote the password, so running this to correct a
 * username or repair a role silently re-keyed the super-admin — a working login
 * that stopped working for no visible reason, with nothing recorded anywhere.
 * The B2B seed had the identical shape, and it is what produced a B2B password
 * change nobody could account for.
 *
 * Now: a missing account is created, and an existing one has only its role,
 * username and display name refreshed. To change the password deliberately, say
 * so:
 *
 *   ADMIN_ROTATE=1 … bun run scripts/seed-admin.ts
 *
 * Either way the change goes through src/services/credentials.ts, which writes
 * a line to the admin activity log naming this script and the reason, and waits
 * for that line to land before the script exits. A credential that can change
 * without a trace is a credential nobody can trust.
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

/**
 * Whether this run was asked to change an existing password.
 *
 * Unset means no. Rotating the super-admin credential is not a side effect of
 * correcting a username, and this script has no way to know whether the value
 * in the shell is the current one or a new one somebody typed.
 */
function rotationRequested(): boolean {
  const raw = (process.env.ADMIN_ROTATE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

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

    if (!rotationRequested()) {
      console.log("Password left as it is. To change it: ADMIN_ROTATE=1");
      return;
    }

    await setUserPassword(existing.id, password, {
      actor: ACTOR,
      reason: "ADMIN_ROTATE was set on a seed run",
    });
    console.log("Password ROTATED, as ADMIN_ROTATE asked. Recorded in the activity log.");
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
