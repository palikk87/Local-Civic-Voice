/**
 * NOTHING THAT FLOATS OVER THE PAGE MAY CLIP WHAT IS INSIDE IT.
 *
 * Reported, in these words: "you cant scroll on the pop up windows making
 * accessing the lower portion nearly impossible."
 *
 * WHAT WAS WRONG, and it was one mistake copied into seven files. Every
 * floating panel in the design system carried `overflow-hidden` — menus,
 * context menus, menubars — or no height ceiling at all — popovers, hover
 * cards, side sheets, bottom drawers. On a tall menu or a short window the
 * panel grew past the bottom of the screen and the part below the fold was not
 * merely off screen, it was CLIPPED: no scrollbar, no wheel, no way down.
 *
 * A dialog had already been fixed once for exactly this. The fix stopped at
 * dialogs, so every other floating primitive kept the defect — which is the
 * shape of bug this file exists to end, because the next primitive somebody
 * adds will have it too unless something is watching.
 *
 * WHY A SOURCE SCAN RATHER THAN A BROWSER. A browser check can only measure
 * the popups a page happens to open. This reads the primitives themselves, so
 * a NEW one added next month is covered the day it lands rather than the day
 * somebody reports it.
 *
 * THE RULE. Every floating content component must carry:
 *   - a ceiling relative to the VIEWPORT (dvh, not a fixed pixel count — a
 *     fixed 24rem is taller than a 500px window), and
 *   - a way to reach what does not fit.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const UI = resolve(import.meta.dir, "..", "..", "apps", "web", "src", "components", "ui");

/**
 * Every primitive that renders a panel over the page, and the class in each
 * that is the panel itself.
 *
 * Listed by hand ON PURPOSE, with a companion test below that fails if a file
 * in the folder starts portalling content and is not named here — so the list
 * cannot quietly fall behind the folder.
 */
const FLOATING = [
  "dialog.tsx",
  "alert-dialog.tsx",
  "dropdown-menu.tsx",
  "context-menu.tsx",
  "menubar.tsx",
  "popover.tsx",
  "hover-card.tsx",
  "select.tsx",
  "sheet.tsx",
  "drawer.tsx",
];

const read = (file: string) => readFileSync(join(UI, file), "utf8");

/** A ceiling measured against the window, not against a guess. */
const VIEWPORT_CEILING = /max-h-\[[^\]]*dvh[^\]]*\]/;
/** Something the content can actually be scrolled in. */
const CAN_BE_REACHED = /overflow-y-auto|overflow-auto|overflow-y-scroll/;

describe("[art3-sec3] a popup never hides what is inside it", () => {
  test("every floating panel is capped to the window", () => {
    const uncapped = FLOATING.filter((file) => !VIEWPORT_CEILING.test(read(file)));

    // If this fails: the panel in that file can grow taller than the screen,
    // and both its ends will hang off with no way to reach either.
    expect(uncapped).toEqual([]);
  });

  test("and what does not fit can be scrolled to", () => {
    // select.tsx is the one honest exception: Radix draws its own scroll
    // buttons inside the listbox, so the panel is deliberately clipped and the
    // viewport within it moves instead. It still needs the ceiling above.
    const needsScroll = FLOATING.filter((file) => file !== "select.tsx");
    const trapped = needsScroll.filter((file) => !CAN_BE_REACHED.test(read(file)));

    expect(trapped).toEqual([]);
  });

  test("no floating panel is clipped with no way out", () => {
    // overflow-hidden on the panel itself was the exact defect: content past
    // the edge is painted nowhere and reachable by nothing.
    const clipped = FLOATING.filter((file) => {
      if (file === "select.tsx") return false;
      const source = read(file);
      // Only the panel's own class matters — an overflow-hidden on an avatar
      // or a rounded corner inside is not this bug.
      return /(?:min-w-\[8rem\]|z-50)[^"]*overflow-hidden/.test(source);
    });

    expect(clipped).toEqual([]);
  });

  test("the list above has not fallen behind the folder", () => {
    // A new primitive that portals content over the page must be added to
    // FLOATING. Without this, the next one ships with the same defect and
    // nothing says so — which is how this bug reached a second report.
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const portals = readdirSync(UI)
      .filter((file) => file.endsWith(".tsx"))
      .filter((file) => {
        const source = read(file);
        return /\.Portal>|Portal\b/.test(source) && /z-50/.test(source);
      });

    const unwatched = portals.filter((file) => !FLOATING.includes(file));
    expect(unwatched).toEqual([]);
  });

  test("a hand-rolled overlay is held to the same rule as a primitive", () => {
    // THE HOLE THAT LET THE SECOND REPORT HAPPEN. The first fix went through
    // components/ui, and the popup the owner actually met — the beta consent
    // gate you get on a new tab — does not use the dialog primitive at all. It
    // is a plain <div className="fixed inset-0"> with a centred card, so the
    // whole category was invisible to this guard and the fix missed it.
    //
    // It was the worst possible one to miss: below the fold on that card are
    // the agree checkbox and the button, and the backdrop deliberately does
    // not dismiss — so a visitor on a short screen could not get past the
    // front door by any means.
    //
    // Anything that covers the viewport is a popup, whoever wrote it.
    const WEB = resolve(import.meta.dir, "..", "..", "apps", "web", "src");
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
      });

    const overlays = walk(WEB).filter((file) => {
      if (file.includes(`${"components"}/ui/`)) return false; // covered above
      return /fixed inset-0/.test(readFileSync(file, "utf8"));
    });
    expect(overlays.length).toBeGreaterThan(0);

    // THREE SHAPES, THREE RULES. One blunt rule here flagged a loading
    // spinner and a correctly-built side panel, and a guard that cries wolf is
    // a guard somebody deletes.
    const trapped = overlays.filter((file) => {
      const source = readFileSync(file, "utf8");

      // NOTHING TO REACH. An overlay with no control in it — a loading
      // screen — cannot hide anything from anybody.
      const hasControls = /<button|<input|<a\s|<Button|onClick=/.test(source);
      if (!hasControls) return false;

      const scrolls = CAN_BE_REACHED.test(source);

      // PINNED TO THE FULL HEIGHT of the window already: its height is bounded
      // by the viewport, so it needs a scroller and not a ceiling.
      const pinnedFullHeight = /\bh-full\b|\binset-y-0\b/.test(source);
      if (pinnedFullHeight) return !scrolls;

      // A CENTRED CARD grows to fit its content and hangs off both ends. It
      // needs both: a ceiling to stop growing, and a scroller to reach the
      // rest. Either alone does nothing — overflow on a box with no maximum
      // height never scrolls, because the box is never too small.
      return !(VIEWPORT_CEILING.test(source) && scrolls);
    });

    // If this fails: that overlay's card can be taller than the window with no
    // way to reach the bottom of it. Give the card
    // max-h-[calc(100dvh-2rem)] and overflow-y-auto.
    expect(trapped.map((f) => f.replace(WEB + "/", ""))).toEqual([]);
  });

  test("no screen switches a dialog's scrolling back off", () => {
    // THE BUG THE OWNER ACTUALLY HIT, after two rounds of me fixing the wrong
    // popups: "no its actually the sign up window I'm having issues with".
    //
    // The dialog primitive sets overflow-y-auto so a tall dialog scrolls. These
    // classes go through tailwind-merge, where the LAST overflow wins — so a
    // screen passing `overflow-hidden` to DialogContent silently turns the
    // scrolling off again. The dialog is still capped to the window, and
    // everything past that height is clipped and reachable by nothing.
    //
    // Sign-up was the worst case because it is the tallest form in the app.
    //
    // overflow-hidden is legitimate for rounded corners — but only alongside a
    // scrolling region inside, which is how the sign-up dialog is built now.
    const WEB = resolve(import.meta.dir, "..", "..", "apps", "web", "src");
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
      });

    const offenders = walk(WEB)
      .filter((file) => !file.includes(`${"components"}/ui/`))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        // Does this file hand overflow-hidden to a dialog-shaped container?
        const smothers =
          /<(?:Dialog|AlertDialog|Sheet|Drawer)Content[^>]*className="[^"]*overflow-hidden/s.test(source);
        if (!smothers) return false;
        // Fine if something inside it scrolls.
        return !CAN_BE_REACHED.test(source);
      });

    expect(offenders.map((f) => f.replace(WEB + "/", ""))).toEqual([]);
  });

  test("the phone's popups are capped and scrollable too", () => {
    // PARITY. The report did not name a platform, and the same mistake was on
    // both: a React Native <Modal> whose panel had no maxHeight and no
    // ScrollView cannot be scrolled either — the top of a long sheet is simply
    // off the top of the phone.
    const MOBILE = resolve(import.meta.dir, "..", "..", "apps", "mobile", "src");
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
      });

    const sheets = walk(MOBILE).filter((file) => /<Modal[\s>]/.test(readFileSync(file, "utf8")));
    expect(sheets.length).toBeGreaterThan(5);

    // TWO KINDS, TWO RULES, because demanding the same of both is how a guard
    // starts flagging correct code and gets switched off.
    //
    //   A SHEET rises over a dimmed backdrop and takes part of the screen. It
    //   needs a ceiling, or it grows off the top, AND something that scrolls.
    //
    //   A FULL-SCREEN modal already is the screen. A ceiling on it would be
    //   wrong. It needs only a way to reach content taller than the display.
    const trapped = sheets.filter((file) => {
      const source = readFileSync(file, "utf8");
      const scrolls = /ScrollView|FlatList/.test(source);
      if (!scrolls) return true;

      const isSheet = /bg-black\/\d/.test(source);
      if (!isSheet) return false;

      // Either spelling of the ceiling counts: a style prop, or the Tailwind
      // class the rest of the phone app uses.
      return !/maxHeight|max-h-\[/.test(source);
    });

    // If this fails: that Modal can grow taller than the phone with no way to
    // reach what is above the fold. Give its panel a maxHeight and put its
    // body in a ScrollView.
    expect(trapped.map((f) => f.replace(MOBILE + "/", ""))).toEqual([]);
  });

  test("the UI folder is where this thinks it is", () => {
    // A path that silently stops resolving would make every test above pass by
    // reading nothing at all.
    expect(existsSync(join(UI, "dialog.tsx"))).toBe(true);
  });
});
