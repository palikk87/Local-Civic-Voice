/**
 * AYE AND NAY MUST NEVER DEPEND ON COLOUR ALONE.
 *
 * WHAT WAS WRONG. The two vote buttons — the most important control in this
 * whole platform — were a mid green and a mid red of almost the same lightness.
 * Around one man in twelve has red-green colour blindness. Run through the
 * Brettel-Vienot simulation, that pair collapsed to two near-identical olives
 * 1.32:1 apart. For those readers there were not two buttons on the screen;
 * there were two grey rectangles distinguished only by which side they were on.
 *
 * It was worse than a normal contrast bug because nothing looked broken. The
 * page passed every check we had, and the failure was invisible to anyone who
 * could see the difference.
 *
 * THE RULE. Aye is the LIGHT button and Nay is the DARK one, so the pair is
 * separated by lightness — the one channel colour blindness leaves intact —
 * before hue is considered at all. Hue, the icons and the words are all
 * reinforcement. None of them is load-bearing on its own.
 *
 * WHY A COMPUTED TEST RATHER THAN A STRING MATCH. Asserting that the CSS
 * "contains bg-support" proves nothing about whether a person can tell the
 * buttons apart. This reads the real tokens out of the real stylesheet, runs
 * the real simulation, and fails on the number. Change the palette however you
 * like; this only cares that the result is still legible.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..", "..");
const read = (...parts: string[]) => readFileSync(resolve(REPO, ...parts), "utf8");

/** The `.dark` block, which is the only theme this app ships. */
function darkBlock(): string {
  const css = read("apps", "web", "src", "index.css");
  const start = css.indexOf("  .dark {");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n  }", start));
}

/** Pull an `--x: H S% L%;` token and return it as sRGB 0-255. */
function token(name: string): [number, number, number] {
  const m = new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(darkBlock());
  if (!m) throw new Error(`--${name} is not defined in the dark theme`);
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;

  // HSL to RGB, the plain textbook conversion.
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h * 6) % 2) - 1));
  const m0 = l - c / 2;
  const sextant = Math.floor(h * 6) % 6;
  const wheel: Array<[number, number, number]> = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = wheel[sextant] ?? wheel[0]!;
  return [(r + m0) * 255, (g + m0) * 255, (b + m0) * 255];
}

const toLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
};

const multiply = (m: number[][], v: number[]) =>
  m.map((row) => row.reduce((sum, cell, i) => sum + cell * (v[i] ?? 0), 0));

/**
 * Deuteranopia, the common form of red-green colour blindness.
 * Brettel, Vienot & Mollon (1999), via the usual LMS projection.
 */
function asDeuteranope(rgb: [number, number, number]): [number, number, number] {
  const RGB_TO_LMS = [
    [17.8824, 43.5161, 4.11935],
    [3.45565, 27.1554, 3.86714],
    [0.0299566, 0.184309, 1.46709],
  ];
  const LMS_TO_RGB = [
    [0.080944, -0.130504, 0.116721],
    [-0.0102485, 0.0540194, -0.113615],
    [-0.000365294, -0.00412163, 0.693513],
  ];
  // The green cone is gone; what it would have reported is reconstructed from
  // the other two.
  const DROP_GREEN = [
    [1, 0, 0],
    [0.494207, 0, 1.24827],
    [0, 0, 1],
  ];

  const linear = rgb.map(toLinear);
  const out = multiply(LMS_TO_RGB, multiply(DROP_GREEN, multiply(RGB_TO_LMS, linear)));
  return out.map((c) => {
    const clamped = Math.min(1, Math.max(0, c));
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return encoded * 255;
  }) as [number, number, number];
}

describe("a person who cannot see red or green can still tell Aye from Nay", () => {
  test("the two buttons are far enough apart with the green cone removed", () => {
    const aye = asDeuteranope(token("support"));
    const nay = asDeuteranope(token("oppose"));

    // 3:1 is the floor for a control a person has to distinguish. The pair as
    // shipped measures about 3.8:1; the pair this replaced measured 1.32:1.
    expect(contrast(aye, nay)).toBeGreaterThanOrEqual(3);
  });

  test("they are separated by lightness, not only by hue", () => {
    // This is the property that makes the test above pass, stated directly so
    // a future palette change fails for a reason somebody can act on.
    const ayeLuminance = relativeLuminance(token("support"));
    const nayLuminance = relativeLuminance(token("oppose"));
    expect(ayeLuminance / nayLuminance).toBeGreaterThan(3);
  });

  test("each button is legible against the card it sits on", () => {
    const card = token("card");
    // The light one carries its own contrast against the card. The dark one
    // cannot — a deep crimson on deep felt is 1.6:1 — so it is given an edge
    // instead, in the button variant where the chip treatment lives.
    expect(contrast(token("support"), card)).toBeGreaterThanOrEqual(3);
    const button = read("apps", "web", "src", "components", "ui", "button.tsx");
    expect(button).toMatch(/nay:[^"]*"[^"]*border-oppose/);
  });

  test("colour is never the only channel", () => {
    const panel = read("apps", "web", "src", "components", "civic", "VotePanel.tsx");
    // An icon and a word on each button, so the meaning survives with no colour
    // at all — a screen reader, a greyscale display, a printed page.
    expect(panel).toContain("ThumbsUp");
    expect(panel).toContain("ThumbsDown");
    expect(panel).toMatch(/"Aye/);
    expect(panel).toMatch(/"Nay/);
  });
});

describe("one word for a vote", () => {
  /**
   * This app used to say five different things for the same action: Support and
   * Oppose on the law page, Yea and Nay in the feed and both profiles, Vote Yea
   * on a bill, Support and Oppose on an executive order, and Agree and Disagree
   * on a Supreme Court case. It is one action. It gets one word, and the word is
   * the platform's own name.
   */
  const SCREENS = [
    ["apps", "web", "src", "components", "civic", "VotePanel.tsx"],
    ["apps", "web", "src", "pages", "Feed.tsx"],
    ["apps", "web", "src", "pages", "Timeline.tsx"],
    ["apps", "mobile", "src", "app", "bill", "[id].tsx"],
    ["apps", "mobile", "src", "app", "executive-order", "[id].tsx"],
    ["apps", "mobile", "src", "app", "scotus", "[id].tsx"],
  ];

  test("no screen offers a vote under any other name", () => {
    // Matches a label a person reads, on its own line — not the API's
    // "support" / "oppose" values, which are the wire format and stay put.
    const banned = /^\s*(Vote\s+)?(Support|Oppose|Supported|Opposed|Agree|Disagree|Yea)\s*$/m;

    const offenders = SCREENS.filter((parts) => banned.test(read(...parts)))
      .map((parts) => parts.join("/"));

    expect(offenders).toEqual([]);
  });

  test("the government's own roll call still says Yea, because that is its word", () => {
    // Congress records a Yea. Quoting it as an Aye would be putting our
    // vocabulary in the government's mouth, which is the one thing this
    // platform must never do.
    const gap = read("apps", "web", "src", "components", "civic", "RepresentationGapPanel.tsx");
    expect(gap).toContain("officialYea");
  });
});

describe("no votes is its own state, in every bar that draws a tally", () => {
  /**
   * THE BUG THIS ENDS, WHICH WAS ALREADY FIXED ONCE. PulseBar draws an empty
   * track when nothing has been cast. PublicPulseBar — the one on the law page,
   * beside the vote buttons — painted its whole track Nay-coloured and then
   * laid an Aye fill over it. With zero votes that rendered as a solid bar of
   * opposition on a law nobody had opened.
   *
   * It read as a landslide against. It was silence. The governing rule here is
   * that when the data does not exist we show nothing, and a full red bar is
   * not nothing.
   *
   * Three components draw this tally across two apps. All three are checked,
   * because the fix landing in two of them is exactly how it survived.
   */
  const BARS: Array<[string, string[]]> = [
    ["web PublicPulseBar", ["apps", "web", "src", "components", "civic", "PublicPulseBar.tsx"]],
    ["web PulseBar", ["apps", "web", "src", "components", "civic", "PulseBar.tsx"]],
    ["mobile PulseBar", ["apps", "mobile", "src", "components", "PulseBar.tsx"]],
  ];

  for (const [name, parts] of BARS) {
    test(`${name} says nothing rather than everything-against`, () => {
      const src = read(...parts);
      // It has to know the difference between an empty tally and a one-sided
      // one, and say so where a screen reader can hear it.
      expect(src).toMatch(/total === 0|total > 0|nobodyHasVoted/);
      expect(src).toMatch(/No votes yet|nobody has voted/i);
    });
  }
});
