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

/**
 * Send the page's API calls to the local stub, wherever the bundle aims them.
 *
 * The backend URL is baked in at build time, so a bundle built for CI points at
 * a host that does not exist and one built locally points at the same origin.
 * The browser checks stub the API from a local server, and the second case
 * happened to work while the first timed out waiting for content that could
 * never arrive — a build-configuration difference showing up as a layout
 * failure, which is the worst possible disguise for it.
 *
 * Intercepting in the browser makes the check independent of how the bundle was
 * built: every /api/ request, to any host, is answered by the stub.
 */
export async function routeApiToLocal(page, base) {
  const local = new URL(base);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.host === local.host) return route.continue();

    const response = await page.request.fetch(`${base}${url.pathname}${url.search}`, {
      method: request.method(),
      headers: request.headers(),
      data: request.postData() ?? undefined,
      failOnStatusCode: false,
    });
    return route.fulfill({ response });
  });
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

/**
 * The version the beta welcome dialog stores when somebody accepts the terms.
 *
 * MUST MATCH TERMS_VERSION in apps/web/src/lib/legal/terms.ts. A stale value
 * here does not fail loudly; it just stops working, and the dialog comes back.
 */
const ACCEPTED_TERMS_KEY = "ayeandnay:accepted-terms-version";

/**
 * Start a browser context with the beta terms already accepted.
 *
 * WHY EVERY CHECK THAT CAN REACH THE FEED NEEDS THIS. The welcome dialog is a
 * consent gate: a full-screen overlay whose backdrop deliberately does nothing,
 * so it cannot be clicked away. That is correct for a citizen and fatal for a
 * check — Playwright reports it as "subtree intercepts pointer events" and then
 * spends thirty seconds retrying a click that can never land. Two checks broke
 * this way the first time the whole suite ran after the dialog shipped, and
 * neither failure said anything about a dialog.
 *
 * Reading the version out of the app's own source rather than repeating it
 * means bumping TERMS_VERSION for a real re-consent does not silently start
 * failing the suite.
 */
export async function acceptTermsBeforeLoad(target) {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");

  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "..", "src", "lib", "legal", "terms.ts"), "utf8");
  const version = source.match(/TERMS_VERSION\s*=\s*"([^"]+)"/)?.[1];

  if (!version) {
    throw new Error(
      "Could not read TERMS_VERSION from apps/web/src/lib/legal/terms.ts, so the beta " +
        "welcome dialog cannot be pre-accepted and every click on the feed will time out.",
    );
  }

  await target.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* a context with no storage is a context with no dialog */
      }
    },
    [ACCEPTED_TERMS_KEY, version],
  );
}
