/**
 * Creates or repairs the two B2B analytics portal accounts.
 *
 * `routes/b2b.ts` has no credential store of its own any more: it verifies
 * against the B2BClient table. So "setting the B2B logins" means creating those
 * two rows and setting their password and API key — which is all this script
 * does.
 *
 * CREDENTIALS COME FROM THE ENVIRONMENT. They used to be constants in
 * routes/b2b.ts, the passwords in plaintext, in a public repository — one pair
 * of which granted the superadmin tier, so reading that file was enough to own
 * the business dashboard. Never put a credential back in a source file.
 *
 * Usage — set the variables in your shell, not in a committed file:
 *
 *   B2B_DEMO_USERNAME=… B2B_DEMO_PASSWORD='…' B2B_DEMO_API_KEY='…' \
 *   B2B_ADMIN_USERNAME=… B2B_ADMIN_PASSWORD='…' B2B_ADMIN_API_KEY='…' \
 *   bun run scripts/seed-b2b.ts
 *
 * Generate the two API keys with something like `openssl rand -base64 48`.
 * They are machine credentials; nothing needs to type them twice.
 *
 * SAFE TO RE-RUN, AND IT WILL NOT CHANGE A CREDENTIAL YOU DID NOT ASK IT TO.
 *
 * It used to. Every run overwrote the password and API key of every account it
 * touched, which meant running it to create the second account silently
 * rotated the first one's password out from under whoever was using it — a
 * working B2B login that stopped working for no visible reason, with nothing
 * recorded anywhere. Setting up one account is not consent to re-key another.
 *
 * So: a missing account is created; an existing one keeps its credentials and
 * only its display name, type and tier are refreshed. To deliberately rotate,
 * say so:
 *
 *   B2B_ROTATE=1 … bun run scripts/seed-b2b.ts        both accounts
 *   B2B_ROTATE=demo … bun run scripts/seed-b2b.ts     just the demo one
 *   B2B_ROTATE=admin … bun run scripts/seed-b2b.ts    just the admin one
 *
 * A rotation prints what it did. The admin portal has the same operation with
 * an audit trail behind it (POST /api/admin/b2b-clients/:id/rotate, which also
 * revokes the sessions the old password opened); prefer that when there is an
 * admin session to hand, and use this when there is not.
 *
 * The two accounts differ only in tier intent, not in mechanism. Their display
 * names and types are not secrets and are not deployment config, so they live
 * here rather than adding four more variables to fill in by hand.
 */
import { prisma } from "../src/prisma";
import {
  createB2BClient,
  rotateB2BCredentials,
} from "../src/services/credentials";

const B2B_DEMO_USERNAME = process.env.B2B_DEMO_USERNAME;
const B2B_DEMO_PASSWORD = process.env.B2B_DEMO_PASSWORD;
const B2B_DEMO_API_KEY = process.env.B2B_DEMO_API_KEY;
const B2B_ADMIN_USERNAME = process.env.B2B_ADMIN_USERNAME;
const B2B_ADMIN_PASSWORD = process.env.B2B_ADMIN_PASSWORD;
const B2B_ADMIN_API_KEY = process.env.B2B_ADMIN_API_KEY;

function requireEnv(): void {
  const missing = [
    !B2B_DEMO_USERNAME && "B2B_DEMO_USERNAME",
    !B2B_DEMO_PASSWORD && "B2B_DEMO_PASSWORD",
    !B2B_DEMO_API_KEY && "B2B_DEMO_API_KEY",
    !B2B_ADMIN_USERNAME && "B2B_ADMIN_USERNAME",
    !B2B_ADMIN_PASSWORD && "B2B_ADMIN_PASSWORD",
    !B2B_ADMIN_API_KEY && "B2B_ADMIN_API_KEY",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("See the usage comment at the top of this file.");
    process.exit(1);
  }
}

/**
 * Advisory only. These accounts read every citizen's aggregated sentiment, and
 * the admin one holds the highest tier, so weak values are worth one line of
 * friction.
 */
function warnIfWeak(label: string, password: string, apiKey: string): void {
  const passwordProblems = [
    password.length < 12 && "shorter than 12 characters",
    !/[^A-Za-z0-9]/.test(password) && "no symbols",
    !/[0-9]/.test(password) && "no digits",
    !/[A-Z]/.test(password) && "no uppercase letters",
  ].filter(Boolean);

  if (passwordProblems.length) {
    console.warn(`⚠️  Weak ${label} password (${passwordProblems.join(", ")}).`);
  }

  // The API key's security rests entirely on being unguessable — it is stored
  // as a plain digest rather than run through a KDF, precisely because a KDF
  // cannot be looked up. That trade is only sound for a high-entropy value.
  if (apiKey.length < 32) {
    console.warn(
      `⚠️  ${label} API key is shorter than 32 characters. It is stored as a ` +
        `SHA-256 digest with no key-stretching, which is safe only for a key ` +
        `with real entropy. Generate one with: openssl rand -base64 48`
    );
  }
}

interface SeedAccount {
  /** Which of the two this is, for the B2B_ROTATE switch. */
  slot: "demo" | "admin";
  username: string;
  password: string;
  apiKey: string;
  name: string;
  type: string;
  tier: string;
}

/**
 * Whether this run was asked to re-key this account.
 *
 * Unset means no. Anything else is read as a deliberate instruction, and an
 * unrecognised value rotates nothing rather than guessing.
 */
function rotationRequested(slot: SeedAccount["slot"]): boolean {
  const raw = (process.env.B2B_ROTATE ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw === "1" || raw === "true" || raw === "all" || raw === "both") return true;
  return raw.split(/[,\s]+/).includes(slot);
}

const ACTOR = { kind: "cli", script: "scripts/seed-b2b.ts" } as const;

async function upsertClient(account: SeedAccount): Promise<void> {
  // Stored lowercased; routes/b2b.ts lowercases before matching, which keeps
  // the case-insensitive login the fixture array had.
  const username = account.username.toLowerCase();

  const existing = await prisma.b2BClient.findUnique({ where: { username } });

  if (existing) {
    const rotate = rotationRequested(account.slot);

    // Name, type and tier are settings. Password and API key are somebody's
    // working credentials, and are left exactly where they are unless this run
    // was told to change them.
    await prisma.b2BClient.update({
      where: { username },
      data: { name: account.name, type: account.type, tier: account.tier },
    });

    if (rotate) {
      // Through services/credentials.ts, which records the change before this
      // returns. That is the difference between "the password changed" and
      // "the password changed, and here is the line that says this script did
      // it, when, and why".
      const { revokedSessions } = await rotateB2BCredentials(
        existing.id,
        { password: account.password, apiKey: account.apiKey },
        { actor: ACTOR, reason: `B2B_ROTATE named the ${account.slot} account` }
      );
      console.log(
        `Updated B2B client. id=${existing.id} username=${username} tier=${account.tier}`
      );
      console.log(
        `  Password and API key ROTATED, as B2B_ROTATE asked. ` +
          `${revokedSessions} live session(s) ended. Recorded in the activity log.`
      );
      return;
    }

    console.log(
      `Updated B2B client. id=${existing.id} username=${username} tier=${account.tier}`
    );
    console.log(
      `  Password and API key left as they are. To change them: B2B_ROTATE=${account.slot}`
    );
    return;
  }

  const created = await createB2BClient(
    {
      username,
      name: account.name,
      type: account.type,
      tier: account.tier,
      password: account.password,
      apiKey: account.apiKey,
    },
    { actor: ACTOR, reason: `Seeded the ${account.slot} business account` }
  );
  console.log(
    `Created B2B client. id=${created.id} username=${created.username} tier=${created.tier}`
  );
}

async function main(): Promise<void> {
  requireEnv();

  warnIfWeak("demo", B2B_DEMO_PASSWORD as string, B2B_DEMO_API_KEY as string);
  warnIfWeak("admin", B2B_ADMIN_PASSWORD as string, B2B_ADMIN_API_KEY as string);

  if (B2B_DEMO_API_KEY === B2B_ADMIN_API_KEY) {
    // apiKeyHash is unique, so this would fail on the second insert anyway —
    // but with a constraint-violation stack trace rather than an explanation.
    console.error("B2B_DEMO_API_KEY and B2B_ADMIN_API_KEY are the same value.");
    console.error("Each account needs its own key; generate two.");
    process.exit(1);
  }

  await upsertClient({
    slot: "demo",
    username: B2B_DEMO_USERNAME as string,
    password: B2B_DEMO_PASSWORD as string,
    apiKey: B2B_DEMO_API_KEY as string,
    name: "Demo Analytics",
    type: "research",
    tier: "enterprise",
  });

  await upsertClient({
    slot: "admin",
    username: B2B_ADMIN_USERNAME as string,
    password: B2B_ADMIN_PASSWORD as string,
    apiKey: B2B_ADMIN_API_KEY as string,
    name: "Civic Platform Admin",
    type: "research",
    tier: "enterprise",
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
