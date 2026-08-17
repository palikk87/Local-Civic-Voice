/**
 * Launch the Chromium that this machine actually has.
 *
 * The three browser checks used to name one absolute path, which was the path
 * on the machine they were written on. That worked there and nowhere else: in
 * CI the browser installs under ~/.cache/ms-playwright with a different build
 * number, so every check failed before it opened a page — and because the
 * failure was "executable not found" rather than a real assertion, it looked
 * like tooling noise rather than a broken gate.
 *
 * Three sources, in order of how much they mean:
 *
 *   1. CHROMIUM_PATH — an explicit override, for a machine with an unusual
 *      layout. Named, so nobody has to edit a script to use it.
 *   2. Playwright's own resolution, which is right whenever the browser was
 *      installed the normal way.
 *   3. A scan of PLAYWRIGHT_BROWSERS_PATH, for the case Playwright's bundled
 *      revision does not match the revision that is present — the situation
 *      the hardcoded path was papering over.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

/** Any chrome binary sitting under the shared browsers directory. */
function scanBrowsersPath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return null;

  const candidates = readdirSync(root)
    .filter((name) => name.startsWith("chromium"))
    // Newest revision first, and a full chromium ahead of a headless shell.
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .flatMap((name) => [
      join(root, name, "chrome-linux", "chrome"),
      join(root, name, "chrome-linux", "headless_shell"),
    ]);

  return candidates.find((path) => existsSync(path)) ?? null;
}

export async function launchChromium(options = {}) {
  const override = process.env.CHROMIUM_PATH;
  if (override) {
    return chromium.launch({ ...options, executablePath: override });
  }

  try {
    return await chromium.launch(options);
  } catch (error) {
    const found = scanBrowsersPath();
    if (!found) {
      throw new Error(
        `No Chromium to run the browser checks with.\n\n` +
          `Install one with \`bunx playwright install chromium\`, or point\n` +
          `CHROMIUM_PATH at an existing binary.\n\n` +
          `Playwright said: ${error.message}`,
      );
    }
    return chromium.launch({ ...options, executablePath: found });
  }
}
