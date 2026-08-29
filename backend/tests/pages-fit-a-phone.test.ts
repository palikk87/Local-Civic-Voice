/**
 * A PAGE FITS THE SCREEN IT IS OPENED ON, AND THE CHECK THAT SAYS SO IS REAL.
 *
 * REPORTED, with two photographs of a phone: opening a law from the feed gave a
 * page wider than the screen with the title cut off, and pinching out to read
 * it left the header bar and the page background painted across only part of
 * the content.
 *
 * THE CAUSE. The law page shows the bill's official text in a
 * `whitespace-pre-wrap` div. pre-wrap preserves the source's line breaks —
 * which a statute genuinely needs — but it also gives that block a min-content
 * width as wide as its longest line, about 640px for congressional text. The
 * block sits inside a CSS grid, and a grid item defaults to `min-width: auto`,
 * meaning it will not shrink below its min-content width. So a 326px column was
 * forced out to 640px and the document became 672px wide on a 390px phone.
 *
 * The misalignment people actually notice is downstream of that: the header and
 * the background are `width: 100%`, which resolves against the VIEWPORT, so
 * they stop at 390px while the article runs on to 672px.
 *
 * WHY IT WAS NOT CAUGHT — AND THIS IS THE PART WORTH GUARDING. It was measured
 * twice and passed twice, because the measurement was not of a phone and not of
 * a page:
 *
 *   1. `newPage({ viewport: { width: 390 } })` is a narrow DESKTOP window.
 *      Chromium only applies `<meta name="viewport">` under mobile emulation,
 *      which needs `isMobile`, a mobile user agent and a device pixel ratio —
 *      all of which Playwright's device descriptors carry and none of which
 *      a bare viewport sets.
 *   2. The detail routes were built with an id that is in no database, so they
 *      rendered "we couldn't load this reference" — an empty box. Nothing is
 *      narrower than nothing. The check was passing on the absence of content.
 *
 * A harness that reports a pass on a blank page in the wrong typeface is worse
 * than no harness, so half of this file is about the harness.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), "utf8");

describe("the law page can be narrower than the text inside it", () => {
  const page = () => read("apps", "web", "src", "pages", "ReferenceDetail.tsx");

  test("both grid items may shrink below their content", () => {
    const src = page();
    // Without these the grid track is sized by min-content and no amount of
    // wrapping inside will save the page.
    expect(src).toMatch(/<article className="[^"]*min-w-0/);
    expect(src).toMatch(/<aside className="[^"]*min-w-0/);
  });

  test("the official text wraps and scrolls in its own box", () => {
    const src = page();
    const panel = /className="([^"]*whitespace-pre-wrap[^"]*)"/.exec(src)?.[1] ?? "";
    expect(panel).toContain("break-words");
    // overflow-y-auto alone leaves the horizontal axis to the page. A line that
    // still cannot wrap has to scroll here, not move the whole document.
    expect(panel).toContain("overflow-auto");
  });

  test("nothing preserving line breaks can set the width of the page", () => {
    // The element-name rule above this one covers h1-h4, p, li, td, dd and dt.
    // The panel that broke was a div, which is exactly the gap.
    const css = read("apps", "web", "src", "index.css");
    expect(css).toMatch(/\[class\*="whitespace-pre-wrap"\]\s*\{\s*overflow-wrap:\s*anywhere/);
  });
});

describe("the check that measures a phone is measuring a phone", () => {
  const script = () => read("apps", "web", "scripts", "phone-fit-check.mjs");

  test("it uses real device descriptors, not a narrow desktop window", () => {
    const src = script();
    expect(src).toMatch(/import \{[^}]*devices[^}]*\} from ['"]playwright['"]/);
    expect(src).toMatch(/newContext\(\{\s*\.\.\.devices\[/);
    // The narrowest screen worth supporting, and the widest Pro Max. A bug that
    // only shows at one width is the normal kind.
    expect(src).toContain("iPhone SE");
    expect(src).toContain("iPhone 15 Pro Max");
  });

  test("it waits for the app to render before believing a number", () => {
    const src = script();
    // "commit" and "domcontentloaded" both fire before React has painted
    // anything in a single-page app.
    expect(src).toMatch(/waitUntil:\s*"load"/);
    expect(src).not.toMatch(/waitUntil:\s*"commit"/);
  });

  test("a page that painted nothing fails instead of fitting", () => {
    // THE ASSERTION THAT MATTERS MOST HERE. A white screen is 0px over on every
    // screen ever made, so without this every other check in the file can be
    // satisfied by rendering nothing at all.
    const src = script();
    expect(src).toMatch(/document\.body\.innerText\.trim\(\)\.length/);
    expect(src).toMatch(/painted nothing/);
  });

  test("it measures the real typeface", () => {
    // Bodoni Moda and Public Sans have different metrics from the fallbacks a
    // sandbox without network access would substitute, and this is a check
    // about widths. Fetched by node, served to the browser.
    const src = script();
    expect(src).toMatch(/fonts\\\.\(googleapis\|gstatic\)/);
    expect(src).toContain("fontsServed");
  });

  test("it opens law pages that actually have a law on them", () => {
    const src = script();
    expect(src).toContain("fixtures");
    // Captured from production, unedited. A made-up law with a made-up sponsor
    // would prove nothing about whether a real one fits.
    for (const name of ["reference-bill.json", "reference-executive-order.json"]) {
      const fixture = JSON.parse(read("apps", "web", "scripts", "fixtures", name));
      expect(fixture.reference.id).toBeTruthy();
      expect(fixture.reference.title.length).toBeGreaterThan(10);
    }
    // And the bill fixture must carry the fields that triggered the report —
    // a sponsor and the official text. The executive order in the same folder
    // has neither and fits fine, which is how the cause was isolated.
    const bill = JSON.parse(read("apps", "web", "scripts", "fixtures", "reference-bill.json"));
    expect(bill.reference.sponsor).toBeTruthy();
    expect((bill.reference.fullText ?? "").length).toBeGreaterThan(1000);
  });
});
