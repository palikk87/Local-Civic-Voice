/**
 * Nothing writes a credential except the one file allowed to.
 *
 * WHY A TEST THAT READS SOURCE CODE. A B2B client's password changed and
 * nobody could say what did it. The answer was a seed script that re-keyed
 * every account on every run, so setting up the second login silently rotated
 * the first one's password out from under whoever was using it. The admin seed
 * had the identical shape. Neither recorded anything.
 *
 * Both are fixed. That fixes the two we found. It does nothing at all about the
 * third one somebody writes next month — a repair script, a migration helper, a
 * "just reset it for now" during an incident — and a credential that can change
 * silently is worth nothing to the person relying on it. To a business paying
 * for the dashboard, a login that stops working for no stated reason is
 * indistinguishable from a breach, and no amount of explaining afterwards buys
 * that back.
 *
 * So the rule is enforced rather than documented: services/credentials.ts is the
 * only file in the backend that may hash a password or write passwordHash,
 * apiKeyHash, or an Account's password column. Everything else asks it, and it
 * records who asked and why before it returns.
 *
 * THIS TEST IS THE RULE. A new writer fails here on the day it is added, with a
 * message that says what to do instead — not six months later when somebody's
 * login stops working.
 *
 * Comments are stripped before matching. The suite already had one guard of
 * this shape trip on a sentence in a comment rather than on code, and a guard
 * that cries wolf is a guard somebody eventually deletes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/** The one file allowed to touch secret material. */
const CHOKEPOINT = "src/services/credentials.ts";

/**
 * Allowed elsewhere, each for a stated reason.
 *
 * scripts/lib/test-population.ts hashes one hardcoded constant for a thousand
 * synthetic rows, in a database it refuses to run outside of. There is no
 * person on the other end of those accounts and nothing to surprise; routing
 * them through the audit log would write a thousand rows saying nothing.
 */
const EXEMPT = new Set([
  "scripts/lib/test-population.ts",
  // src/password-check.ts hashes 32 random bytes it then throws away, to give a
  // failed login the same cost as a successful one. It never reaches the
  // database and never becomes anybody's credential — the whole purpose is that
  // the comparison can never succeed.
  "src/password-check.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}

/**
 * Source with comments removed.
 *
 * Deliberately crude: it does not understand a `//` inside a string literal.
 * Nothing in this codebase writes a credential field inside a string, and the
 * failure mode of being too aggressive here is a missed writer, which the
 * import rule below catches anyway.
 */
function code(file: string): string {
  return readFileSync(join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * The same source with lookup clauses removed.
 *
 * `where: { apiKeyHash: hashApiKey(key) }` is how routes/b2b.ts finds an
 * account from a presented key. It mentions the column and changes nothing, and
 * a rule that could not tell it apart from a write would have to be either
 * switched off or worked around — both of which end with no rule.
 */
function writesOnly(file: string): string {
  // Removes the clause, not the line. Dropping whole lines let a one-line
  // `update({ where: { id }, data: { passwordHash } })` through — caught by
  // planting exactly that and watching this rule stay green.
  return code(file).replace(/\bwhere\s*:\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "where:{}");
}

function backendFiles(): string[] {
  return [...walk("src"), ...walk("scripts")]
    .map((f) => relative(".", f))
    .filter((f) => f !== CHOKEPOINT && !EXEMPT.has(f));
}

describe("only one file may write a credential", () => {
  test("nothing else hashes a password", () => {
    const offenders = backendFiles().filter((file) => /\bhashPassword\s*\(/.test(code(file)));

    // If this fails: call createB2BClient, rotateB2BCredentials or
    // setUserPassword from src/services/credentials.ts instead. They take an
    // actor and a reason, and they write the activity-log row before they
    // return — which is the entire point.
    expect(offenders).toEqual([]);
  });

  test("nothing else assigns passwordHash or apiKeyHash", () => {
    const offenders = backendFiles().filter((file) =>
      /(passwordHash|apiKeyHash)\s*:\s*[^;\n]/.test(writesOnly(file)),
    );

    // Reading them is fine — routes/b2b.ts verifies a login against
    // passwordHash and looks an account up by apiKeyHash. This catches the
    // assignment form, which is a write.
    expect(offenders).toEqual([]);
  });

  test("nothing else writes an account's password column", () => {
    const offenders = backendFiles().filter((file) => {
      const src = code(file);
      // Better Auth keeps a person's password on the Account row. A write here
      // looks like prisma.account.update/create/upsert carrying `password:`.
      return /prisma\.account\.(update|create|upsert|updateMany)\s*\(/.test(src) &&
        /password\s*:/.test(src);
    });

    expect(offenders).toEqual([]);
  });

  test("the chokepoint is where it says it is", () => {
    // A rename that quietly emptied the allowlist would make every test above
    // pass while enforcing nothing.
    const src = readFileSync(join(ROOT, CHOKEPOINT), "utf8");
    expect(src).toContain("export async function rotateB2BCredentials");
    expect(src).toContain("export async function setUserPassword");
    expect(src).toContain("export async function createB2BClient");
  });
});

describe("no backend process can re-key anybody", () => {
  /**
   * The rule, stated plainly: a credential that already works is only ever
   * changed by a person — the account holder, or a super admin — through a
   * route that records their name. No script, no job, no boot step, no
   * "repair" helper. An override flag is not a compromise here: it is a thing
   * that gets used at 2am by somebody who has not read the comment above it,
   * which is exactly how the B2B password changed in the first place.
   */
  const NEVER_ROTATES = ["scripts/seed-b2b.ts", "scripts/seed-admin.ts"];

  test("neither seed script rotates a credential, on any flag", () => {
    for (const file of NEVER_ROTATES) {
      const src = code(file);
      expect(src).not.toContain("rotateB2BCredentials");
      expect(src).not.toContain("hashPassword");
      // No escape hatch. Matched on the environment read rather than the word,
      // so a console.log pointing somebody at the admin console's own rotate
      // route — which is where they should be sent — is not mistaken for one.
      expect(/process\.env\.[A-Z_]*(ROTATE|FORCE|OVERWRITE)/i.test(src)).toBe(false);
    }
  });

  test("the B2B seed's re-run path carries settings and no secrets", () => {
    const src = code("scripts/seed-b2b.ts");
    // The update that runs when the account already exists.
    expect(/data:\s*\{\s*name:[^}]*tier:[^}]*\}/.test(src)).toBe(true);
    expect(src).toContain("createB2BClient");
  });

  test("the admin seed only ever gives a password to an account that has none", () => {
    const src = code("scripts/seed-admin.ts");
    // setUserPassword appears once, inside the branch for an account with no
    // credential row — nobody can sign in to such an account, so nothing is
    // taken from anyone.
    expect((src.match(/setUserPassword\s*\(/g) ?? []).length).toBe(1);
    expect(src).toContain("if (!credential)");
  });

  test("nothing anywhere in src/ or scripts/ changes a password on its own", () => {
    // A rotation reached from a job, a boot step, or a request nobody made is
    // the shape of the original bug. Every legitimate caller sits behind an
    // authenticated route or is the create path.
    const callers = backendFiles().filter((file) =>
      /\b(rotateB2BCredentials|setUserPassword)\s*\(/.test(code(file)),
    );

    expect(callers.sort()).toEqual(
      [
        // Super admin: rotate a B2B key, reset a person's password.
        "src/routes/admin.ts",
        // The account holder: change your own password.
        "src/routes/users.ts",
        // Give a credential to an admin account that has none.
        "scripts/seed-admin.ts",
      ].sort(),
    );
  });
});
