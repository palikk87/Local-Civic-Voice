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

    // THE PASSWORD HALF OF THIS IS GONE RATHER THAN GUARDED.
    //
    // This used to assert that BOTH rotate buttons opened a confirmation. The
    // password one no longer exists: it was the only control in the system that
    // could produce a password nobody chose, and "Set password" already did the
    // job with a value a person picked. Asked for directly — simplify rather
    // than build something that watches it. See no-generated-password.test.ts,
    // which fails if it ever comes back.
    expect(source).not.toContain('setRotating({ client, what: "password" })');

    // The API key still rotates, and still asks first.
    expect(source).toContain('setRotating({ client, what: "apiKey" })');

    // The confirmation says whose account it is. A dialog that says "are you
    // sure?" without naming the client is how the wrong row gets rotated.
    expect(source).toContain("{rotating.client.name}");

    // Setting a password still says what it costs, which is the part people do
    // not expect: every session the old password opened is ended.
    expect(source).toMatch(/signs out every session/i);
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

describe("every reader sees the same brief", () => {
  /**
   * THE RULE, in the owner's words: "every single user should have the same
   * exact brief."
   *
   * There was a control on the card that replaced it. It began as an unlabelled
   * circular arrow — one stray click from a paid model call, on a card every
   * reader opens — and was first fixed by labelling it and asking before
   * spending. That fixed the money and left the real problem standing: force
   * replaces the STORED brief, so one reader pressing it changes what every
   * other reader sees of that law, including people reading it at that moment.
   * Two citizens discussing the same bill could be looking at different
   * summaries with nothing on either screen saying so.
   *
   * So it is gone rather than guarded. A brief is written once per version of
   * the law and reused forever; when the law changes, the version moves and the
   * ordinary request path offers a new one. Regenerating on demand belongs to
   * whoever runs the platform, not to whoever happens to be reading.
   */
  test("the brief card has no control that replaces a stored brief", () => {
    const source = readFileSync(
      resolve(REPO, "apps/web/src/components/civic/CitizensBriefCard.tsx"),
      "utf8",
    );

    expect(source).not.toContain("onRewrite");
    expect(source).not.toMatch(/setConfirmingRewrite/);
    expect(source.toLowerCase()).not.toContain(">rewrite<");
  });

  test("nothing in either app asks the server to force a brief", () => {
    // The server still accepts force, because the law itself changing is a real
    // reason to regenerate. No client may be the one to ask.
    const offenders: string[] = [];

    for (const file of sources) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (/\bstart\(\s*true\s*\)/.test(line) || /getCitizenBrief\([^)]*,\s*true\s*\)/.test(line)) {
          offenders.push(`${relative(REPO, file)}:${index + 1}  ${line.trim()}`);
        }
      });
    }

    expect(
      offenders,
      offenders.length
        ? `A client is forcing a brief to be rewritten, which replaces the copy every other ` +
            `reader sees.\n${offenders.join("\n")}`
        : "",
    ).toEqual([]);
  });

  test("the hook offers no rewrite", () => {
    const source = readFileSync(
      resolve(REPO, "apps/web/src/hooks/use-citizen-brief.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*rewrite:/m);
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
