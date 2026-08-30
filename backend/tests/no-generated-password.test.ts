/**
 * NOTHING CAN PRODUCE A PASSWORD NOBODY CHOSE.
 *
 * THE INCIDENT. The owner's own B2B login stopped working. He was certain he
 * had not changed it, and he had to set a new password from the admin console
 * to get back in. Nobody could say what moved it.
 *
 * WHAT WAS ALREADY GUARDED, AND HELD. The backend cannot re-key anybody on its
 * own: services/credentials.ts is the only file that may write a password hash,
 * it refuses without a reason, and credential-writes.test.ts fails the build if
 * a second writer appears. None of that was violated.
 *
 * WHAT WAS LEFT. A button. Both admin consoles carried "Password" next to "Set
 * password" — one asked the server to invent a random password and show it
 * once; the other took one a person had chosen. The first was the only thing in
 * the entire system that could produce a credential nobody picked, and on the
 * phone it fired on a single tap with no confirmation at all: one press against
 * a live paying client, signing out every session it had open.
 *
 * THE FIX HE ASKED FOR, in his words: "let's remove the randomized refresh
 * password option. It's redundant of the manual password setter. And old
 * passwords are not stored so they can't be reverted to. I think simplifying
 * this process is better than over engineering it."
 *
 * He is right, and this is the cheaper guard. A detector that watches for
 * unexplained password changes is a second mechanism to check the first one.
 * Deleting the control means there is exactly one way a password changes and a
 * person is always on the other end of it.
 *
 * THIS TEST IS THAT RULE. Source-read rather than clicked, because the property
 * is "no such control exists anywhere" and a browser can only prove things
 * about the screen it is looking at.
 *
 * The API key is deliberately exempt throughout. A key is not something anyone
 * types, so generating one is the only sensible way to issue it.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });

const clientSources = [
  ...walk(resolve(REPO, "apps/web/src")),
  ...walk(resolve(REPO, "apps/mobile/src")),
];

/** Comments describe the removal at length. Only code counts. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Asking the rotate endpoint for a password WITHOUT supplying one.
 *
 * The endpoint takes `{ password: true }` to mean "invent one and show it to
 * me", and `{ password: true, newPassword: "..." }` to mean "use this". Only
 * the first is forbidden, so the check is per call rather than per token —
 * "Set password" sends the word `password` too, and must keep working.
 */
const ROTATE_CALL = /rotate[^\n]*\(([^)]*)\)|setRotating\(\s*\{([^}]*)\}/g;

describe("no control anywhere generates a password", () => {
  test("NO CLIENT ASKS THE SERVER TO INVENT A PASSWORD", () => {
    const offenders: string[] = [];

    for (const file of clientSources) {
      const source = stripComments(readFileSync(file, "utf8"));

      for (const match of source.matchAll(ROTATE_CALL)) {
        const args = match[1] ?? match[2] ?? "";
        const wantsPassword = /['"]password['"]|password:\s*true/.test(args);
        const suppliesOne = /newPassword/.test(args);
        if (wantsPassword && !suppliesOne) {
          offenders.push(`${relative(REPO, file)}  ${match[0].trim().slice(0, 100)}`);
        }
      }
    }

    expect(
      offenders,
      offenders.length
        ? `Something is asking for a generated password. Use the "set a chosen ` +
            `password" path instead — a password a person picked is one they can ` +
            `hand over.\n${offenders.join("\n")}`
        : "",
    ).toEqual([]);
  });

  test("the admin consoles have no button offering to generate one", () => {
    const web = stripComments(
      readFileSync(resolve(REPO, "apps/web/src/components/admin/B2BClientsTab.tsx"), "utf8"),
    );
    const mobile = stripComments(
      readFileSync(resolve(REPO, "apps/mobile/src/app/admin/b2b-clients.tsx"), "utf8"),
    );

    // The exact two shapes that were removed. Not "the word password", which
    // both files still contain legitimately — "Set password" sends
    // `what: "password"` alongside a newPassword, and must keep working.
    expect(web).not.toContain('setRotating({ client, what: "password" })');
    expect(mobile).not.toContain("rotate(client.id, 'password')");

    // And the state that drove the web dialog can now only ever hold a key.
    expect(web).toContain('useState<{ client: B2BClient; what: "apiKey" } | null>');
  });

  test("and the chosen-password path is still there", () => {
    // Removing the generator is only safe because the deliberate path exists.
    // If this ever goes too, a super admin has no way to help somebody locked
    // out, and the pressure to reintroduce a generator comes straight back.
    const web = readFileSync(
      resolve(REPO, "apps/web/src/components/admin/B2BClientsTab.tsx"),
      "utf8",
    );
    expect(web).toContain("setSettingPasswordFor");
    expect(web).toContain("newPassword");
  });
});

describe("a password never moves without a name against it", () => {
  test("the credentials service refuses a change with no reason", () => {
    // Already true; pinned here because it is the other half of the guard. A
    // change that cannot say why it happened is the thing that made this
    // incident unanswerable for a week.
    const source = readFileSync(
      resolve(REPO, "backend/src/services/credentials.ts"),
      "utf8",
    );

    expect(source).toMatch(/function requireReason/);
    expect(source).toMatch(/throw new Error\(\s*\n?\s*"A credential change needs a reason/);

    // Every function that writes secret material calls it.
    for (const fn of [
      "createB2BClient",
      "rotateB2BCredentials",
      "setB2BMemberPassword",
      "setUserPassword",
    ]) {
      const body = source.slice(source.indexOf(`export async function ${fn}`));
      const upToNextExport = body.slice(0, body.indexOf("\nexport ") + 1 || undefined);
      expect(upToNextExport, `${fn} does not call requireReason`).toContain("requireReason(");
    }
  });
});
