/**
 * Everything that has to be green before work is finished.
 *
 *   bun run verify
 *
 * One command instead of nine, because a checklist somebody has to remember is
 * a checklist that gets half-run at 2am. Every check that has ever caught a
 * real defect here is in it, and each one prints its own verdict so a failure
 * names itself rather than scrolling past.
 *
 * Deliberately NOT including the deploy check: this runs before pushing, when
 * the deployment is supposed to be behind. `bun run deploy-check` answers the
 * other question — whether what is on main is what is serving — and it belongs
 * after the push, not before.
 *
 * Needs a throwaway Postgres for the backend suite. Set TEST_DATABASE_URL, or
 * it uses the local default.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

interface Check {
  name: string;
  cwd: string;
  cmd: string[];
  /** Why this exists — printed when it fails, so the failure explains itself. */
  guards: string;
  /** Extra environment, where CI sets something the local default does not. */
  env?: Record<string, string>;
}

const CHECKS: Check[] = [
  {
    name: "backend typecheck",
    cwd: "backend",
    cmd: ["bunx", "tsc", "--noEmit"],
    guards: "the API compiles",
  },
  {
    name: "backend tests",
    cwd: "backend",
    // `bun run test`, not `bun test`: the script carries the timeout. Booting
    // the real server takes about four seconds, and bun's default five-second
    // budget per hook made that a coin flip — six tests failed here while the
    // same suite passed when run by hand with a longer one.
    cmd: ["bun", "run", "test"],
    guards:
      "deletes persist, merges lose nothing, names resolve, briefs are written once, " +
      "and no vote is invented",
  },
  {
    name: "web typecheck",
    cwd: "apps/web",
    cmd: ["bun", "run", "typecheck"],
    guards: "the web app compiles",
  },
  {
    name: "web lint",
    cwd: "apps/web",
    cmd: ["bun", "run", "lint"],
    guards: "no lint errors (warnings are allowed)",
  },
  {
    name: "web build",
    cwd: "apps/web",
    cmd: ["bun", "run", "build"],
    guards: "the bundle builds, and stamps itself with the commit",
    // The same backend URL CI builds with. Without it the local build defaults
    // to same-origin and the browser checks below exercise a bundle nobody
    // deploys — which is how a check that passed here failed in CI for a
    // reason that had nothing to do with the thing it measures.
    env: { VITE_BACKEND_URL: "https://ci.invalid" },
  },
  {
    name: "web render-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "render-check"],
    guards: "the production bundle actually boots — a chunking mistake builds green and white-screens",
  },
  {
    name: "web layout-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "layout-check"],
    guards: "the reference page does not overflow or overlap between 1024 and 1568px",
  },
  {
    name: "web related-laws-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "related-laws-check"],
    guards: "Related Laws renders, and a live record always beats the local fallback",
  },
  {
    name: "web brief-button-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "brief-button-check"],
    guards:
      "the Citizen's Brief is asked for rather than automatic, and every state ends " +
      "somewhere — no spinner without an exit",
  },
  {
    name: "web library-search-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "library-search-check"],
    guards:
      "the Library searches when asked and never on its own — typing is not a request",
  },
  {
    name: "web verify-email-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "verify-email-check"],
    guards:
      "there is somewhere to type the emailed code, and the page never claims a send " +
      "that did not happen",
  },
  {
    name: "web share-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "share-check"],
    guards:
      "a law can be shared to your own timeline from where you found it, resolved to the " +
      "master reference, and never posted on your behalf",
  },
  {
    name: "web every-page-check",
    cwd: "apps/web",
    cmd: ["bun", "run", "every-page-check"],
    guards:
      "every route the app mounts paints something and does not crash, signed out and " +
      "signed in, against a backend that is empty and that says no",
  },
  {
    name: "mobile typecheck",
    cwd: "apps/mobile",
    cmd: ["bun", "run", "typecheck"],
    guards: "the phone app compiles",
  },
  {
    name: "mobile lint",
    cwd: "apps/mobile",
    cmd: ["bun", "run", "lint"],
    guards: "no lint errors (warnings are allowed)",
  },
];

/**
 * The backend suite needs a Postgres. Say so in one line rather than letting it
 * surface as a Prisma stack trace forty lines into a test run — a check that
 * fails for an environment reason should not look like a broken product.
 */
function databaseReachable(): { ok: boolean; url: string } {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/civicvoice_test";
  const parsed = new URL(url);
  const probe = spawnSync(
    "bash",
    ["-c", `exec 3<>/dev/tcp/${parsed.hostname}/${parsed.port || 5432}`],
    { stdio: "ignore" },
  );
  return { ok: probe.status === 0, url };
}

const db = databaseReachable();
if (!db.ok) {
  console.error(
    `No Postgres at ${new URL(db.url).host}.\n\n` +
      `The backend suite boots the real server against a real database. Start one, or\n` +
      `point TEST_DATABASE_URL at a throwaway Postgres, then run this again.`,
  );
  process.exit(1);
}

const failed: Check[] = [];
const started = Date.now();

for (const check of CHECKS) {
  if (!existsSync(check.cwd)) {
    console.log(`SKIP  ${check.name} — ${check.cwd} not found`);
    continue;
  }

  process.stdout.write(`....  ${check.name}`);
  const at = Date.now();
  const run = spawnSync(check.cmd[0]!, check.cmd.slice(1), {
    cwd: check.cwd,
    encoding: "utf8",
    env: { ...process.env, ...check.env },
  });
  const secs = ((Date.now() - at) / 1000).toFixed(1);

  if (run.status === 0) {
    process.stdout.write(`\r ok   ${check.name} (${secs}s)\n`);
    continue;
  }

  process.stdout.write(`\rFAIL  ${check.name} (${secs}s)\n`);
  console.log(`        guards: ${check.guards}`);
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trimEnd().split("\n");
  for (const line of output.slice(-25)) console.log(`        ${line}`);
  console.log("");
  failed.push(check);
}

const total = ((Date.now() - started) / 1000).toFixed(0);

if (failed.length > 0) {
  console.error(`\n${failed.length} of ${CHECKS.length} checks failed in ${total}s:`);
  for (const check of failed) console.error(`  - ${check.name}: ${check.guards}`);
  process.exit(1);
}

console.log(`\nAll ${CHECKS.length} checks green in ${total}s.`);
console.log("Push to main, then `bun run deploy-check` once the deploy settles.");
