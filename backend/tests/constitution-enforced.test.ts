/**
 * "ENFORCED IN CODE" HAS TO MEAN SOMETHING.
 *
 * Every clause of the Constitution carries that badge on two screens, and the
 * phone showed a green bar reading "11 of 11 provisions are enforced in code".
 * All of it was hand-typed. The counter could not report a failure even in
 * principle, three of its claims were untrue, and the `codeReference` beside
 * each flag named client files that had been deleted.
 *
 * This file is the difference between a badge and a claim.
 *
 * THE RULE: a clause may set `enforcedInCode: true` only if a test somewhere
 * under backend/tests carries that clause's id in its name, like
 * `[art2-sec2]`. Then the badge cannot outrun the suite — the build goes red
 * the moment a clause claims something nothing proves.
 *
 * It cuts both ways. A clause with a test but flagged false is also reported,
 * because understating what the platform does is its own kind of untruth, and
 * that is exactly how Article V sat for a week after it was built.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every `id: 'artN-secN'` in the shared constitution, with its flag. */
function clauses(): { id: string; title: string; enforced: boolean }[] {
  const source = readFileSync(
    join(import.meta.dir, "..", "..", "packages", "civic-core", "src", "constitution.ts"),
    "utf8",
  );

  const found: { id: string; title: string; enforced: boolean }[] = [];
  const pattern =
    /id: '(art\d+-sec\d+)',\s*\n\s*title: '([^']*)',[\s\S]*?enforcedInCode: (true|false),/g;

  for (const match of source.matchAll(pattern)) {
    found.push({ id: match[1]!, title: match[2]!, enforced: match[3] === "true" });
  }
  return found;
}

/** Every test name in the backend suite, as one searchable blob. */
function suiteText(): string {
  const dir = join(import.meta.dir);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

describe("the Constitution's own badge", () => {
  test("the document parses and has the clauses we think it has", () => {
    const found = clauses();
    // Five articles. If this number moves, somebody changed the Constitution,
    // and that should be a deliberate act rather than a surprise.
    expect(found.length).toBe(14);
    expect(found.map((c) => c.id)).toContain("art1-sec1");
    expect(found.map((c) => c.id)).toContain("art5-sec2");
  });

  test("NO CLAUSE CLAIMS ENFORCEMENT WITHOUT A TEST NAMED FOR IT", () => {
    const suite = suiteText();

    const unproven = clauses()
      .filter((clause) => clause.enforced)
      .filter((clause) => !suite.includes(`[${clause.id}]`))
      .map((clause) => `${clause.id} — ${clause.title}`);

    expect(unproven).toEqual([]);
  });

  test("no clause understates itself either", () => {
    // Article V section 2 sat flagged `false` for a week after the System-Wide
    // Reset shipped, with a full test file behind it. A promise kept and not
    // claimed is still a document that does not match its code.
    const suite = suiteText();

    const understated = clauses()
      .filter((clause) => !clause.enforced)
      .filter((clause) => suite.includes(`[${clause.id}]`))
      .map((clause) => `${clause.id} — ${clause.title}`);

    expect(understated).toEqual([]);
  });

  test("the file no longer points at code that does not exist", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "packages", "civic-core", "src", "constitution.ts"),
      "utf8",
    );
    // `codeReference` named client paths, three of which had been deleted.
    expect(source).not.toContain("codeReference:");
  });
});

describe("one document, not two", () => {
  test("the web app derives the Constitution rather than keeping its own copy", async () => {
    // apps/web/src/lib/founding-documents.ts used to hold a second, complete,
    // hand-maintained copy of the Constitution and Bill of Rights — fifteen
    // enforcement flags among them. Two copies of a supreme document is two
    // drafts and a coin toss.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const web = readFileSync(
      join(import.meta.dir, "..", "..", "apps", "web", "src", "lib", "founding-documents.ts"),
      "utf8",
    );

    // It must read from the shared package...
    expect(web).toContain("@civic/core/constitution");
    expect(web).toContain("@civic/core/bill-of-rights");

    // ...and must not carry clause text or flags of its own.
    expect(web).not.toContain("enforcedInCode: true");
    expect(web).not.toContain("enforcedInCode: false");
    expect(web).not.toContain("art1-sec1");
  });
});
