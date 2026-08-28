/**
 * A PERSON'S NAME GOES TO THAT PERSON.
 *
 * apps/web/src/components/people/PersonLink.tsx was written for exactly this,
 * and its own notes say why: "One component rather than a Link at each site,
 * because 'clickable everywhere' fails the moment somebody adds the twelfth
 * place a name appears and forgets."
 *
 * It failed anyway. A bug report — "doesn't allowing clicking to open user
 * profile" — was filed against the busiest screen in the app, and looking for
 * the twin of it turned up seven:
 *
 *   apps/web/src/pages/Feed.tsx                 plain text
 *   apps/mobile/src/app/(tabs)/index.tsx        a button wired to `() => {}`
 *   apps/web/src/pages/Timeline.tsx             comment previews
 *   apps/mobile/src/app/(tabs)/timeline.tsx     comment previews AND the author
 *   apps/mobile/src/components/CommentSection.tsx  face, name and handle
 *   apps/web/src/pages/HashtagPage.tsx          name nested inside a link
 *   apps/web/src/components/admin/PostsTab.tsx  a reported post's author
 *
 * A component is not a rule. This is the rule.
 *
 * WHAT IT CHECKS: any component that renders somebody's name out of a post,
 * comment or feed item must also, somewhere in that same component, link to
 * their profile. Component-scoped rather than line-scoped, because a name and
 * the tap target around it are often twenty lines apart and a proximity window
 * just moves the argument to how wide the window is.
 *
 * There are no exemptions and the mechanism to add one is deliberately absent.
 * The moment this file grows an allowlist it becomes the thing it replaced.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const APPS = [
  join(import.meta.dir, "..", "..", "apps", "web", "src"),
  join(import.meta.dir, "..", "..", "apps", "mobile", "src"),
];

/** `{post.author.displayName}` and friends — a person's name, being rendered. */
const RENDERS_A_NAME = /\{\s*\w+\.(?:author|user)\.displayName\s*\}/;

/** Any of the four ways this codebase reaches a profile. */
const LINKS_TO_A_PROFILE =
  /PersonName|PersonAvatar|PersonHandle|router\.push\(`\/user\/|to=\{`\/user\//;

/** The start of a component or a top-level binding — where a body begins. */
const BODY_STARTS = /^(?:export\s+)?(?:default\s+)?function\s+\w+|^(?:export\s+)?const\s+\w+\s*[:=]/;

function screens(): string[] {
  const found: string[] = [];
  for (const root of APPS) {
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (entry.endsWith(".tsx")) found.push(path);
      }
    };
    walk(root);
  }
  return found;
}

/**
 * Every place a name is rendered with no way to reach the person, as
 * `path:line — the offending line`.
 */
function inertNames(): string[] {
  const offences: string[] = [];

  for (const path of screens()) {
    const lines = readFileSync(path, "utf8").split("\n");
    const starts = lines.flatMap((line, i) => (BODY_STARTS.test(line) ? [i] : []));

    lines.forEach((line, i) => {
      if (!RENDERS_A_NAME.test(line)) return;

      // The component this render belongs to: from the nearest binding above
      // it to the next one below.
      const from = Math.max(0, ...starts.filter((s) => s <= i));
      const nextStarts = starts.filter((s) => s > i);
      const to = nextStarts.length ? Math.min(...nextStarts) : lines.length;
      const body = lines.slice(from, to).join("\n");

      if (!LINKS_TO_A_PROFILE.test(body)) {
        const short = path.slice(path.indexOf("apps/"));
        offences.push(`${short}:${i + 1} — ${line.trim()}`);
      }
    });
  }

  return offences;
}

/*
 * NO CLAUSE TAG ON THIS ONE, DELIBERATELY. It was written with `[bor-art3]`
 * on it out of habit, and that was wrong: Amendment III is about proving a
 * tally against the votes beneath it, and this test proves nothing of the
 * kind. A tag is a claim that a clause is enforced, and hanging one on a
 * loosely related test is how the badge stopped meaning anything the first
 * time. This guards a product rule, not a constitutional one.
 */
describe("a name you can read is a person you can look up", () => {
  test("the scan finds the names — it is looking at real screens", () => {
    // If this drops to nothing the pattern has changed shape and the test above
    // is passing because it is checking nothing at all.
    let rendered = 0;
    for (const path of screens()) {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        if (RENDERS_A_NAME.test(line)) rendered += 1;
      }
    }
    expect(rendered).toBeGreaterThan(10);
  });

  test("NO SCREEN RENDERS SOMEBODY'S NAME WITH NO WAY TO REACH THEM", () => {
    expect(inertNames()).toEqual([]);
  });

  test("the component that made this a rule is still the one place it lives", () => {
    const personLink = readFileSync(
      join(import.meta.dir, "..", "..", "apps", "web", "src", "components", "people", "PersonLink.tsx"),
      "utf8",
    );
    // stopPropagation belongs here and not at each call site, so a name inside
    // a card does not swallow the click meant for the card.
    expect(personLink).toContain("stopPropagation");
    expect(personLink).toContain("/user/");
  });
});
