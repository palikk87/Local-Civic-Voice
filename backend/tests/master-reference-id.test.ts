/**
 * Naming is the foundation of the master reference system, so it is the one
 * part that gets a property test rather than a handful of examples.
 *
 * The claim under test: build → normalize → parse is the identity, for every
 * bill type, every executive order, every docket. If it is not, two code paths
 * can spell one law two ways, and one law gets two records, two vote pools and
 * two briefs.
 *
 * Four of these round trips failed before this module existed. `hres`, `sres`,
 * `sjres` and `sconres` all lost their first letter to a leftmost-first regex
 * alternation, which is how `s-res-829-119` ended up in the live database while
 * search looked for `sres-829-119` and found nothing.
 *
 * No database, no server. These are pure functions and the test should stay
 * runnable in a second with nothing installed but bun.
 */

import { describe, expect, test } from "bun:test";
import {
  BILL_TYPES,
  ReferenceKind,
  billReferenceId,
  buildReferenceId,
  canonicalReferenceId,
  parseReferenceId,
} from "../src/services/master-reference-id";
import { normalizeReferenceId, ReferenceType } from "../src/services/deduplication-service";

// A spread of bill numbers rather than one: single digit, the four-digit range
// most real bills land in, and the five-digit numbers a late-session Congress
// reaches. A parser that mis-splits letters from digits tends to do it at a
// particular length.
const NUMBERS = ["1", "82", "829", "1443", "4836", "12345"];
const CONGRESSES = [117, 118, 119];

/**
 * The normalizer this module replaced, copied here verbatim.
 *
 * Kept because the evidence for the repair migration is "the old code wrote
 * these exact strings", and deleting the old code would delete the evidence.
 * A test that asserted the mangling against the *current* normalizer would
 * start failing the moment the bug was fixed, which is backwards.
 */
function oldNormalizer(type: "bill" | "executive_order" | "scotus_case", id: string): string {
  let normalized = id.toLowerCase().trim();
  normalized = normalized.replace(/[\s_.]+/g, "-");
  normalized = normalized.replace(/-+/g, "-");
  normalized = normalized.replace(/^-|-$/g, "");

  if (type === "bill") {
    normalized = normalized.replace(
      /^(h\.?r\.?|s\.?|h\.?j\.?res\.?|s\.?j\.?res\.?|h\.?con\.?res\.?|s\.?con\.?res\.?|h\.?res\.?|s\.?res\.?)[\s-]*/,
      (_, prefix: string) => prefix.replace(/\./g, "").replace(/\s+/g, "") + "-",
    );
  } else if (type === "executive_order") {
    normalized = normalized.replace(/^(e\.?o\.?|executive[-\s]?order)[\s-]*/, "eo-");
  } else {
    normalized = normalized.replace(/^no\.?\s*/, "");
  }

  return normalized;
}

describe("bill ids round-trip", () => {
  test("every bill type survives build → canonicalize → parse unchanged", () => {
    const broken: string[] = [];

    for (const billType of BILL_TYPES) {
      for (const number of NUMBERS) {
        for (const congress of CONGRESSES) {
          const built = buildReferenceId({ kind: "bill", billType, number, congress });
          const canonical = canonicalReferenceId(ReferenceKind.BILL, built);
          const parsed = parseReferenceId(ReferenceKind.BILL, canonical);

          if (canonical !== built) {
            broken.push(`${built} → canonicalized to ${canonical}`);
            continue;
          }
          if (
            parsed?.kind !== "bill" ||
            parsed.billType !== billType ||
            parsed.number !== number ||
            parsed.congress !== congress
          ) {
            broken.push(`${built} → parsed back as ${JSON.stringify(parsed)}`);
          }
        }
      }
    }

    // Named, not counted. A failure here should say which type broke, because
    // "4 of 144 failed" is exactly the report that let this bug live for months.
    expect(broken).toEqual([]);
  });

  test("a bill named without a Congress stays without one", () => {
    // Inventing 119 for someone who typed "HR 4836" would attach their post to
    // a law they did not choose.
    const parsed = parseReferenceId(ReferenceKind.BILL, "HR 4836");
    expect(parsed).toEqual({ kind: "bill", billType: "hr", number: "4836", congress: null });
    expect(buildReferenceId(parsed!)).toBe("hr-4836");
  });
});

describe("the four types the old normalizer broke", () => {
  // These are the exact strings the old alternation produced. Each is a real
  // shape: `s-res-829-119` was read out of the live database.
  const mangled: Array<[string, string]> = [
    ["hr-es-1443-119", "hres-1443-119"],
    ["s-res-829-119", "sres-829-119"],
    ["s-jres-88-119", "sjres-88-119"],
    ["s-conres-14-119", "sconres-14-119"],
  ];

  test("the old normalizer really did write these strings", () => {
    // The justification for the repair migration, on the record. Every one of
    // these is what the shipped code produced from a correctly-spelled id.
    expect(oldNormalizer("bill", "hres-1443-119")).toBe("hr-es-1443-119");
    expect(oldNormalizer("bill", "sres-829-119")).toBe("s-res-829-119");
    expect(oldNormalizer("bill", "sjres-88-119")).toBe("s-jres-88-119");
    expect(oldNormalizer("bill", "sconres-14-119")).toBe("s-conres-14-119");

    // And the four it happened to get right, so the migration is not tempted to
    // touch them.
    expect(oldNormalizer("bill", "hr-4836-119")).toBe("hr-4836-119");
    expect(oldNormalizer("bill", "s-1779-119")).toBe("s-1779-119");
    expect(oldNormalizer("bill", "hjres-105-119")).toBe("hjres-105-119");
    expect(oldNormalizer("bill", "hconres-14-119")).toBe("hconres-14-119");
  });

  for (const [stored, correct] of mangled) {
    test(`${stored} is understood as ${correct}`, () => {
      // Both directions matter. The stored form has to resolve to the right
      // record (so nothing that was written under the broken name is orphaned),
      // and the correct form has to stay correct.
      expect(canonicalReferenceId(ReferenceKind.BILL, stored)).toBe(correct);
      expect(canonicalReferenceId(ReferenceKind.BILL, correct)).toBe(correct);
    });
  }
});

describe("bill ids as people write them", () => {
  const spellings: Array<[string, string]> = [
    ["H.R. 4836", "hr-4836"],
    ["HR 4836", "hr-4836"],
    ["hr4836", "hr-4836"],
    ["hr-4836", "hr-4836"],
    ["H.R.4836", "hr-4836"],
    ["  hr   4836  ", "hr-4836"],
    ["S. 1779", "s-1779"],
    ["S.J.Res. 88", "sjres-88"],
    ["H.Con.Res. 14", "hconres-14"],
    ["H. Res. 1443", "hres-1443"],
    ["S.Res. 829", "sres-829"],
    ["hr‑4836", "hr-4836"], // non-breaking hyphen, pasted from a PDF
    ["hr-0082-119", "hr-82-119"], // leading zeros are not part of a bill number
  ];

  for (const [typed, expected] of spellings) {
    test(`"${typed}" → ${expected}`, () => {
      expect(canonicalReferenceId(ReferenceKind.BILL, typed)).toBe(expected);
    });
  }
});

describe("executive orders", () => {
  test("numbered orders round-trip", () => {
    for (const eoNumber of ["13985", "14147", "14304"]) {
      const built = buildReferenceId({ kind: "executive_order", eoNumber });
      expect(canonicalReferenceId(ReferenceKind.EXECUTIVE_ORDER, built)).toBe(built);
      expect(parseReferenceId(ReferenceKind.EXECUTIVE_ORDER, built)).toEqual({
        kind: "executive_order",
        eoNumber,
      });
    }
  });

  test("an unnumbered order keeps its Federal Register document number whole", () => {
    // The hyphen is part of the document number. The old code stripped every
    // non-digit here, which would have turned this into "202608928".
    expect(canonicalReferenceId(ReferenceKind.EXECUTIVE_ORDER, "eo-2026-08928")).toBe(
      "eo-2026-08928",
    );
  });

  const spellings: Array<[string, string]> = [
    ["EO 14147", "eo-14147"],
    ["E.O. 14147", "eo-14147"],
    ["Executive Order 14147", "eo-14147"],
    ["executive-order-14147", "eo-14147"],
    ["eo14147", "eo-14147"],
  ];

  for (const [typed, expected] of spellings) {
    test(`"${typed}" → ${expected}`, () => {
      expect(canonicalReferenceId(ReferenceKind.EXECUTIVE_ORDER, typed)).toBe(expected);
    });
  }
});

describe("SCOTUS dockets", () => {
  test("dockets round-trip", () => {
    for (const docket of ["22-451", "23-175", "24-1234", "23a994", "22o141"]) {
      const built = buildReferenceId({ kind: "scotus_case", docket });
      expect(canonicalReferenceId(ReferenceKind.SCOTUS_CASE, built)).toBe(built);
      expect(parseReferenceId(ReferenceKind.SCOTUS_CASE, built)).toEqual({
        kind: "scotus_case",
        docket,
      });
    }
  });

  const spellings: Array<[string, string]> = [
    ["No. 22-451", "22-451"],
    ["no. 22-451", "22-451"],
    ["22-451", "22-451"],
    ["scotus-22-451", "22-451"],
    ["23A994", "23a994"],
  ];

  for (const [typed, expected] of spellings) {
    test(`"${typed}" → ${expected}`, () => {
      expect(canonicalReferenceId(ReferenceKind.SCOTUS_CASE, typed)).toBe(expected);
    });
  }

  test("the old normalizer left a leading hyphen on a cited docket", () => {
    // "No. 22-451" → "-22-451", because it stripped the prefix after separators
    // had already been turned into hyphens and never re-trimmed. Pinned so the
    // migration that repairs those rows has a reason on the record.
    expect(oldNormalizer("scotus_case", "No. 22-451")).toBe("-22-451");
    expect(canonicalReferenceId(ReferenceKind.SCOTUS_CASE, "-22-451")).toBe("22-451");
  });
});

describe("ids this module does not own", () => {
  // The library resolver mints these for documents with no official number: a
  // Federal Register rule that is not an executive order, a CourtListener
  // opinion with no docket. They are valid ids. Normalizing them must not
  // rewrite them into something that collides with a real one.
  const passthrough: Array<[typeof ReferenceKind[keyof typeof ReferenceKind], string]> = [
    [ReferenceKind.EXECUTIVE_ORDER, "fr-2026-08928"],
    [ReferenceKind.SCOTUS_CASE, "cl-9412"],
    [ReferenceKind.BILL, "fr-2026-08928"],
  ];

  for (const [kind, id] of passthrough) {
    test(`${id} survives normalization as ${kind}`, () => {
      expect(canonicalReferenceId(kind, id)).toBe(id);
      expect(parseReferenceId(kind, id)).toBeNull();
    });
  }
});

describe("building from congress.gov's own fields", () => {
  test("type, number and congress become one id", () => {
    expect(billReferenceId({ type: "HR", number: "3194", congress: 119 })).toBe("hr-3194-119");
    expect(billReferenceId({ type: "SRES", number: 829, congress: 119 })).toBe("sres-829-119");
    expect(billReferenceId({ type: "HRES", number: "1443", congress: 119 })).toBe("hres-1443-119");
  });

  test("an unrecognised measure type produces nothing rather than a guess", () => {
    // A record named after a typo is worse than no record: it is unfindable,
    // uncorrectable, and it splits the vote count for the law it shadows.
    expect(billReferenceId({ type: "hrr", number: "1", congress: 119 })).toBeNull();
    expect(billReferenceId({ type: "hr", number: "", congress: 119 })).toBeNull();
  });
});

describe("normalizeReferenceId now delegates here", () => {
  // deduplication-service still exports normalizeReferenceId — a dozen call
  // sites use it — but it must not have its own opinion about naming any more.
  const cases: Array<[typeof ReferenceType[keyof typeof ReferenceType], string]> = [
    [ReferenceType.BILL, "hres-1443-119"],
    [ReferenceType.BILL, "H.R. 4836"],
    [ReferenceType.BILL, "s-res-829-119"],
    [ReferenceType.EXECUTIVE_ORDER, "EO 14147"],
    [ReferenceType.SCOTUS_CASE, "No. 22-451"],
  ];

  for (const [type, raw] of cases) {
    test(`${type}: "${raw}" agrees with canonicalReferenceId`, () => {
      expect(normalizeReferenceId(type, raw)).toBe(canonicalReferenceId(type, raw));
    });
  }
});
