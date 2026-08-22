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
 * Safe to re-run. On an account that already exists it updates the role, the
 * username, and — unlike the version this replaced, which only set a password on
 * creation — the password too. So this is also how the admin password is rotated.
 */
import { hashPassword } from "better-auth/crypto";
import { auth } from "../src/auth";
import { prisma } from "../src/prisma";

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
    // Hashed with Better Auth's own function, so the console's verifyPassword
    // and ordinary citizen sign-in both accept it.
    const hash = await hashPassword(password);
    const credential = existing.accounts[0];

    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: { role: "superadmin", username, name },
      }),
      credential
        ? prisma.account.update({ where: { id: credential.id }, data: { password: hash } })
        : prisma.account.create({
            data: {
              userId: existing.id,
              accountId: existing.id,
              providerId: "credential",
              password: hash,
            },
          }),
    ]);

    console.log(`Updated super admin. id=${existing.id} username=${username} role=superadmin`);
    console.log(credential ? "Password rotated." : "Password set (no credential row existed).");
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
