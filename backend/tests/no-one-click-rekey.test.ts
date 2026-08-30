/**
 * NOBODY'S CREDENTIAL MOVES ON ONE CLICK.
 *
 * THE INCIDENT. A B2B password stopped working and the person it belonged to
 * was certain he had not changed it. He had to reset it by hand to get back in.
 * The standing rule on this project is absolute and predates the incident: a
 * password is changed only when its owner deliberately changes it, or when an
 * administrator deliberately changes it. Never by anything else.
 *
 * WHY THE EARLIER FIXES DID NOT PREVENT IT. They were about the backend, and
 * they held. `services/credentials.ts` is the only module that may write a
 * password hash, it demands a reason, it records who did it, and
 * tests/credential-writes.test.ts fails if a rotation call reappears in a seed
 * script. None of that was violated.
 *
 * The path that was left open was a button. In the admin console's B2B clients
 * tab, each row carried a tier dropdown, a button labelled "Password", one
 * labelled "Set password", one labelled "API key", and a delete icon — five
 * controls in a wrapping flex row. "Password" and "API key" called
 * `rotate.mutate(...)` directly. One click, no confirmation, irreversible,
 * against a live paying client, signing out every session it had open.
 *
 * Delete asked first. Rotation did not, and rotation is the more dangerous of
 * the two to get wrong: a deleted client is obviously gone and somebody says
 * so, whereas a rotated one looks exactly like a working account that has
 * started rejecting the correct password. From the desk of the business paying
 * for the dashboard, that is indistinguishable from a breach.
 *
 * WHAT THIS TEST PINS. Reading the source, not the screen, because that is
 * where the property lives: no handler that fires a credential rotation may be
 * wired straight to a click. It has to go through something that asks. A
 * browser check can confirm the dialog appears; only this can confirm there is
 * no second, forgotten button somewhere that skips it.
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

const sources = [
  ...walk(resolve(REPO, "apps/web/src")),
  ...walk(resolve(REPO, "apps/mobile/src")),
].filter((file) => !file.includes("/components/ui/"));

/**
 * A click handler that fires a rotation on the spot.
 *
 * Matches `onClick={() => rotate.mutate(...)}` and the same shape with any
 * mutation whose name says it rotates or re-keys. What it deliberately does NOT
 * match is `onClick={() => setRotating(...)}` — opening a dialog is the correct
 * wiring, and the dialog's own confirm button firing the mutation is correct
 * too, because reaching it took a deliberate second act.
 */
const ONE_CLICK_ROTATE =
  /onClick=\{\s*\(\)\s*=>\s*[A-Za-z_$][\w$]*(?:rotate|rekey|reKey|resetPassword)[\w$]*\s*\.\s*mutate/i;

/** The same, for a mutation literally called `rotate`. */
const ONE_CLICK_NAMED_ROTATE = /onClick=\{\s*\(\)\s*=>\s*rotate\s*\.\s*mutate/;

describe("a credential never moves on a single click", () => {
  test("no click handler fires a rotation directly", () => {
    const offenders: string[] = [];

    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (ONE_CLICK_ROTATE.test(line) || ONE_CLICK_NAMED_ROTATE.test(line)) {
          offenders.push(`${relative(REPO, file)}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      offenders.length
        ? `A credential rotation is wired straight to a click. It must open a confirmation ` +
            `first — see B2BClientsTab's rotating dialog for the shape.\n${offenders.join("\n")}`
        : "",
    ).toEqual([]);
  });

  test("the B2B clients tab asks before rotating, and names the account", () => {
    const source = readFileSync(
      resolve(REPO, "apps/web/src/components/admin/B2BClientsTab.tsx"),
      "utf8",
    );

    // The buttons open the confirmation rather than acting.
    expect(source).toContain('setRotating({ client, what: "password" })');
    expect(source).toContain('setRotating({ client, what: "apiKey" })');

    // The confirmation says whose account it is. A dialog that says "are you
    // sure?" without naming the client is how the wrong row gets rotated.
    expect(source).toContain("{rotating.client.name}");

    // And says what it costs, which is the part people do not expect.
    expect(source).toMatch(/signed out/i);
  });

  test("deleting a client still asks too", () => {
    // Not new, but it is the neighbouring control and the reason the gap was
    // visible at all. If somebody removes this guard the row is unsafe again.
    const source = readFileSync(
      resolve(REPO, "apps/web/src/components/admin/B2BClientsTab.tsx"),
      "utf8",
    );
    expect(source).toMatch(/window\.confirm\(/);
  });
});

describe("a paid model call never happens on a single click", () => {
  /**
   * The same principle as the credential buttons, and found the same night, by
   * somebody glancing at the page for thirty seconds.
   *
   * The Citizen's Brief card carried an unlabelled circular arrow in its
   * corner, on every law that already had a brief. It called the brief endpoint
   * with force=true, which deliberately skips the stored brief — the whole
   * point of "written once, reused forever" — and pays for a fresh model call.
   * It had an aria-label and no visible text, no tooltip, and nothing between
   * the click and the charge. On a card every reader opens, that is somebody's
   * bill, one stray click at a time.
   */
  test("rewriting a brief asks first, and says what it is", () => {
    const source = readFileSync(
      resolve(REPO, "apps/web/src/components/civic/CitizensBriefCard.tsx"),
      "utf8",
    );

    // The visible control opens the confirmation; it does not call onRewrite.
    expect(source).toContain("setConfirmingRewrite(true)");

    // It says what it is in words, not only to a screen reader.
    expect(source).toContain('title="Write this brief again from the law\'s text"');

    // And onRewrite is only reachable from inside the confirmation.
    const direct = /onClick=\{\s*onRewrite\s*\}/;
    expect(direct.test(source)).toBe(false);
  });
});

describe("the backend still refuses to re-key on its own", () => {
  test("only the credentials service writes a password hash", () => {
    // The earlier rule, restated here so that a single test file describes the
    // whole property: the backend cannot re-key anybody, and now neither can a
    // stray click.
    const backend = walk(resolve(REPO, "backend/src"));
    const writers = backend.filter((file) => {
      const source = readFileSync(file, "utf8");
      return /passwordHash:\s*await\s+hashPassword\(/.test(source);
    });

    expect(writers.map((file) => relative(REPO, file))).toEqual([
      "backend/src/services/credentials.ts",
    ]);
  });
});
