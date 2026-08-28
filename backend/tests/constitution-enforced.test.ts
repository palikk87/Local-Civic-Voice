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
 *
 * The Amendments — the Bill of Rights, now part of the Constitution — are held
 * to the same rule, by the same reading, under ids like `[bor-art5]`. They
 * were exempt until this file was extended, and the badge on the phone read
 * "5 Articles enshrined in code": the article count, wearing the word
 * "enforced".
 *
 * And the last test here is the one the rewrite was for. The documents claimed
 * five things the platform does not do. Words are cheap to reintroduce, so
 * they are banned by name, in the shipped text, forever.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CONSTITUTION_FILE = join(
  import.meta.dir,
  "..",
  "..",
  "packages",
  "civic-core",
  "src",
  "constitution.ts",
);

function documentSource(): string {
  return readFileSync(CONSTITUTION_FILE, "utf8");
}

/** Every `id: 'artN-secN'` in the shared constitution, with its flag. */
function clauses(): { id: string; title: string; enforced: boolean }[] {
  const source = documentSource();

  const found: { id: string; title: string; enforced: boolean }[] = [];
  const pattern =
    /id: '(art\d+-sec\d+)',\s*\n\s*title: '([^']*)',[\s\S]*?enforcedInCode: (true|false),/g;

  for (const match of source.matchAll(pattern)) {
    found.push({ id: match[1]!, title: match[2]!, enforced: match[3] === "true" });
  }
  return found;
}

/** Every `id: 'bor-artN'` — the Amendments, read the same way. */
function amendments(): { id: string; title: string; enforced: boolean }[] {
  const source = documentSource();

  const found: { id: string; title: string; enforced: boolean }[] = [];
  const pattern =
    /id: '(bor-art\d+)',\s*\n\s*number: '[^']*',\s*\n\s*title: '([^']*)',[\s\S]*?enforcedInCode: (true|false),/g;

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

describe("[art6-sec1] the Constitution's own badge", () => {
  test("the document parses and has the clauses we think it has", () => {
    const found = clauses();
    // Six articles. If this number moves, somebody changed the Constitution,
    // and that should be a deliberate act rather than a surprise.
    expect(found.length).toBe(16);
    expect(found.map((c) => c.id)).toContain("art1-sec1");
    expect(found.map((c) => c.id)).toContain("art5-sec3");
    expect(found.map((c) => c.id)).toContain("art6-sec1");
  });

  test("the Amendments parse too — all five of them", () => {
    const found = amendments();
    expect(found.length).toBe(5);
    expect(found.map((a) => a.id)).toEqual([
      "bor-art1",
      "bor-art2",
      "bor-art3",
      "bor-art4",
      "bor-art5",
    ]);
  });

  test("NO CLAUSE CLAIMS ENFORCEMENT WITHOUT A TEST NAMED FOR IT", () => {
    const suite = suiteText();

    const unproven = [...clauses(), ...amendments()]
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

    const understated = [...clauses(), ...amendments()]
      .filter((clause) => !clause.enforced)
      .filter((clause) => suite.includes(`[${clause.id}]`))
      .map((clause) => `${clause.id} — ${clause.title}`);

    expect(understated).toEqual([]);
  });

  test("the file no longer points at code that does not exist", () => {
    // `codeReference` named client paths, three of which had been deleted.
    expect(documentSource()).not.toContain("codeReference:");
  });

  test("the counters count, and the two agree with the text", async () => {
    const { CONSTITUTION, getConstitutionalEnforcement, getAmendmentEnforcement } =
      await import("../../packages/civic-core/src/constitution");

    const articles = getConstitutionalEnforcement();
    expect(articles.total).toBe(clauses().length);
    expect(articles.enforced).toBe(clauses().filter((c) => c.enforced).length);

    const rights = getAmendmentEnforcement();
    expect(rights.total).toBe(CONSTITUTION.amendments.length);
    expect(rights.enforced).toBe(amendments().filter((a) => a.enforced).length);
  });
});

/**
 * THE FIVE SENTENCES THAT WERE NOT TRUE.
 *
 *   "immediate demotion by a Jury"   — a Jury makes a Finding. Nothing is
 *                                      taken away. The Delegators are told and
 *                                      they decide.
 *   "the Magnification of Leaders"   — nothing multiplies anybody's reach.
 *   "Encrypted personal data"        — passwords are hashed and the platform's
 *                                      own keys are encrypted. Nothing about a
 *                                      Citizen is.
 *   "verify citizenship"             — citizenship is never checked. An email
 *                                      is confirmed; a jurisdiction is
 *                                      optional and self-declared.
 *   "Trust Score determines influence" — it determines nothing.
 *
 * This reads the shipped text — preamble, clauses, definitions, Amendments —
 * and not the comments around it, because the comments have to be free to
 * explain what was removed and why.
 */
describe("[art6-sec1] the documents do not promise what the platform does not do", () => {
  async function shippedText(): Promise<string> {
    const { CONSTITUTION } = await import("../../packages/civic-core/src/constitution");

    return [
      CONSTITUTION.preamble,
      CONSTITUTION.amendmentsNote,
      CONSTITUTION.definitions.title,
      CONSTITUTION.definitions.note,
      ...CONSTITUTION.definitions.terms.flatMap((t) => [t.term, t.meaning]),
      ...CONSTITUTION.articles.flatMap((a) => [
        a.title,
        ...a.sections.flatMap((s) => [s.title, s.content]),
      ]),
      ...CONSTITUTION.amendments.flatMap((a) => [a.title, a.subtitle, a.content]),
    ]
      .join("\n")
      .toLowerCase();
  }

  const BANNED: { word: string; because: string }[] = [
    { word: "magnif", because: "nothing on this platform multiplies anybody's reach" },
    { word: "demot", because: "a Jury makes a Finding; it takes nothing away" },
    { word: "encrypted personal data", because: "nothing about a Citizen is encrypted" },
    { word: "citizenship", because: "citizenship is never checked" },
    {
      word: "trust score determines",
      because: "the Trust Score informs a delegation and determines nothing",
    },
    {
      word: "master reference id",
      because: "an internal identifier is not a thing to govern a citizen with",
    },
  ];

  for (const { word, because } of BANNED) {
    test(`"${word}" appears nowhere — ${because}`, async () => {
      expect(await shippedText()).not.toContain(word);
    });
  }

  test("the Bill of Rights is the same document, not a second one", async () => {
    const { CONSTITUTION } = await import("../../packages/civic-core/src/constitution");
    const { BILL_OF_RIGHTS } = await import("../../packages/civic-core/src/bill-of-rights");

    // Same objects, not copies that happen to match today.
    expect(BILL_OF_RIGHTS.articles).toBe(CONSTITUTION.amendments);
    expect(BILL_OF_RIGHTS.version).toBe(CONSTITUTION.version);
    expect(BILL_OF_RIGHTS.effectiveDate).toBe(CONSTITUTION.effectiveDate);

    // And it says so on its face.
    expect(BILL_OF_RIGHTS.preamble).toContain("Part of this Constitution");
  });

  test("the version and date moved with the text", async () => {
    const { CONSTITUTION } = await import("../../packages/civic-core/src/constitution");
    // The old text was stamped v1.0 / 2025-01-01. Replacing a document while
    // keeping its date is the file lying about itself.
    expect(CONSTITUTION.version).not.toBe("1.0");
    expect(CONSTITUTION.effectiveDate).not.toBe("2025-01-01");
  });
});

describe("one document, not two", () => {
  test("the web app derives the Constitution rather than keeping its own copy", async () => {
    // apps/web/src/lib/founding-documents.ts used to hold a second, complete,
    // hand-maintained copy of the Constitution and Bill of Rights — fifteen
    // enforcement flags among them. Two copies of a supreme document is two
    // drafts and a coin toss.
    const web = readFileSync(
      join(import.meta.dir, "..", "..", "apps", "web", "src", "lib", "founding-documents.ts"),
      "utf8",
    );

    // It must read from the shared package...
    expect(web).toContain("@civic/core/constitution");

    // ...and must not carry clause text or flags of its own.
    expect(web).not.toContain("enforcedInCode: true");
    expect(web).not.toContain("enforcedInCode: false");
    expect(web).not.toContain("art1-sec1");
  });
});
