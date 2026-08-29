/**
 * AN ACTION UPDATES THE PAGE. IT DOES NOT MOVE THE PERSON.
 *
 * Reported in these words: "when changing my vote it refreshes the whole
 * screen and takes me to the top."
 *
 * WHAT WAS ACTUALLY HAPPENING, because nothing navigated and nothing reloaded.
 * A vote invalidates every query that shows the law — correct, and deliberate:
 * the feed, the timeline, discover, the library and the detail page must all
 * agree on one tally. The fault was in what a screen did WHILE that refetch was
 * in flight. A screen that swaps its content for a skeleton gets shorter; the
 * browser clamps scrollY to the new document height; the content comes back and
 * the reader is at the top of a page they were halfway down. It reads exactly
 * like a refresh. It is a collapse.
 *
 * THE RULE, AND WHERE IT LIVES. `placeholderData: keepPreviousData` on the
 * query client: a query that already has an answer keeps showing it while
 * fetching the next one. That covers a refetch AND a key change, which is the
 * case a per-screen `isLoading` check misses. Set once, on both clients, rather
 * than remembered on every screen — because "remembered on every screen" is how
 * the Library ended up gating its whole result list on isFetching.
 *
 * A first load still shows a skeleton. That is the one time a skeleton is
 * honest: there is no answer yet to hold.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), "utf8");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });

describe("both apps hold the last answer while fetching the next", () => {
  const CLIENTS: Array<[string, string[]]> = [
    ["web", ["apps", "web", "src", "lib", "query-client.ts"]],
    ["phone", ["apps", "mobile", "src", "lib", "query-client.ts"]],
  ];

  for (const [name, parts] of CLIENTS) {
    test(`the ${name} query client keeps previous data`, () => {
      const src = read(...parts);
      expect(src).toContain("keepPreviousData");
      // Imported from the library rather than hand-rolled, so it behaves the
      // way the rest of the ecosystem expects.
      expect(src).toMatch(/import \{[^}]*keepPreviousData[^}]*\} from ['"]@tanstack\/react-query['"]/);
      // And actually set as the default, not merely imported.
      expect(src).toMatch(/placeholderData:\s*keepPreviousData/);
    });
  }
});

describe("no screen blanks itself during a background refetch", () => {
  /**
   * isLoading is "there is no answer yet". isFetching is "a request is in
   * flight", which is TRUE during every background refresh of data already on
   * screen. Gating content on isFetching is how a page throws away what it is
   * showing and collapses.
   *
   * This reads every screen in both apps, so a new one is covered the day it
   * lands rather than the day somebody reports the jump.
   */
  const APPS: Array<[string, string[]]> = [
    ["web", ["apps", "web", "src"]],
    ["phone", ["apps", "mobile", "src"]],
  ];

  for (const [name, parts] of APPS) {
    test(`${name}: nothing gates its content on isFetching`, () => {
      const root = resolve(REPO, ...parts);
      // Comments are stripped first. The rule is about what the code DOES;
      // a file that explains the bug in a comment is not committing it, and a
      // guard that cannot tell the difference cries wolf on its own docs.
      const stripComments = (src: string) =>
        src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      const offenders = walk(root)
        .filter((file) => {
          const src = stripComments(readFileSync(file, "utf8"));
          // The pattern that collapses a page: a loading flag that is true
          // whenever a refresh is running, not only on first load.
          //
          // isFetchingNextPage is fine and deliberately allowed — it drives the
          // "Load more" button's own label, not the list above it.
          return /\b(isLoading|isPending)\s*\|\|\s*isFetching\b(?!NextPage)/.test(src)
            || /\bisFetching\s*\|\|\s*(isLoading|isPending)\b/.test(src);
        })
        .map((file) => file.replace(REPO + "/", ""));

      expect(offenders).toEqual([]);
    });
  }
});

describe("a vote does not send anybody anywhere", () => {
  test("the vote pipeline neither navigates nor reloads", () => {
    // Whatever else changes about voting, it stays on the page it was cast
    // from. A reload would also throw away the optimistic update this file
    // exists to deliver.
    for (const app of ["web", "mobile"]) {
      const src = app === "web"
        ? read("apps", "web", "src", "lib", "mobile", "reference-votes.ts")
        : read("apps", "mobile", "src", "lib", "reference-votes.ts");

      expect(src).not.toContain("location.reload");
      expect(src).not.toContain("location.href");
      expect(src).not.toContain("navigate(");
    }
  });

  test("the tally is updated in place before the server is even asked", () => {
    // The optimistic write is what makes a vote feel instant. Without it the
    // button waits on a round trip and the number arrives with the refetch,
    // which is the other half of "it refreshes".
    const src = read("apps", "web", "src", "lib", "mobile", "reference-votes.ts");
    expect(src).toContain("applyOptimisticReferenceVote");
    expect(src).toContain("setLocalVote");
  });
});

describe("a refetch of the same law does not rebuild what is on screen", () => {
  /**
   * THE ONE THAT ACTUALLY THREW PEOPLE TO THE TOP.
   *
   * useCitizenBrief resets itself when it is pointed at a different law —
   * correct, or the previous law's brief sits under the new law's title. It
   * used to do that whenever `initialBrief` changed IDENTITY, and initialBrief
   * comes out of a React Query cache: every refetch mints a new object with
   * identical contents. A vote invalidates that query on purpose. So a vote
   * reset the brief to "idle", a tall panel of text became a short button, the
   * document lost hundreds of pixels, and the browser clamped the scroll
   * position — dumping a reader who had just pressed Aye at the top of the page.
   *
   * The reset keys on the law now. The dependency list is the fix, so the
   * dependency list is what this guards.
   */
  test("the brief resets on a new reference, not on a new object", () => {
    const src = read("apps", "web", "src", "hooks", "use-citizen-brief.ts");

    const resetEffect = /useEffect\(\(\) => \{[\s\S]*?setState\(initialState[\s\S]*?\}, \[([^\]]*)\]\)/.exec(src);
    expect(resetEffect).not.toBeNull();

    const deps = (resetEffect?.[1] ?? "").split(",").map((d) => d.trim()).filter(Boolean);
    expect(deps).toContain("referenceId");
    // These two change on every refetch of the SAME law. Depending on either
    // is the bug.
    expect(deps).not.toContain("initialBrief");
    expect(deps).not.toContain("initialState");
  });
});
