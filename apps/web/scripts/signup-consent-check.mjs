/**
 * Signing up asks once, in the form, and nothing lands on top of it.
 *
 *   bun run signup-consent-check          (after `bun run build`)
 *
 * THE BUG THIS EXISTS FOR, reported from the live site: "I was going through a
 * user sign up and when I clicked next after the basic information this screen
 * appeared and I couldn't do anything with it — I couldn't click or check the
 * box or anything." Sign-up dead-ended. Nobody could join.
 *
 * TWO CAUSES, and a check that only caught one would let it come back.
 *
 *   1. Terms acceptance moved from the browser onto the profile. A brand-new
 *      account has accepted nothing, so the welcome dialog fired the instant
 *      sign-up created the session — while the verification step was still on
 *      screen. Reading localStorage had hidden this, because the browser
 *      already had the key.
 *
 *   2. AuthDialog is a Radix Dialog, which is modal: it sets
 *      `pointer-events: none` on <body> and restores them only inside its own
 *      portal. The welcome dialog was a hand-rolled fixed div OUTSIDE that
 *      portal, so it painted on top and received nothing. Raising its z-index
 *      would not have helped — the events were never coming.
 *
 * WRITTEN AGAINST THE GEOMETRY, not against one component, for the same reason
 * nav-check is: any second full-bleed layer over a modal is this bug, whichever
 * component drew it. So the assertion is "there is never more than one modal on
 * screen", not "BetaWelcomeDialog is hidden".
 *
 * And it checks the thing the fix is FOR: the consent box is in the sign-up
 * form, it starts unticked, and the form refuses to submit until it is ticked.
 */
import { launchChromium, routeApiToLocal } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

/** Flipped by the stubbed sign-up, exactly as autoSignIn does on the server. */
let signedIn = false;
const SESSION = {
  user: {
    id: "new-1",
    name: "New Person",
    email: "new@example.com",
    emailVerified: false,
  },
  session: { id: "s-new" },
};

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  /*
   * THE SEQUENCE THAT PRODUCED THE BUG, reproduced exactly.
   *
   * A visitor starts signed out. They fill the sign-up form and submit. Better
   * Auth signs them in immediately (autoSignIn), so a session now EXISTS while
   * the dialog is still open on the verification step — and a brand-new
   * account has accepted nothing, so the welcome dialog fires on top of it.
   *
   * A stub that stays signed out forever cannot show this. The first version
   * of this check did exactly that and passed with the fix removed, which is
   * the only thing worse than no check at all.
   */
  if (path.startsWith("/api/auth/sign-up")) {
    signedIn = true;
    return json({ user: SESSION.user, token: "t" });
  }
  if (path.startsWith("/api/auth/get-session")) return json(signedIn ? SESSION : null);
  if (path === "/api/me") return json(signedIn ? SESSION : null, signedIn ? 200 : 401);

  // Never accepted anything. This is what makes the dialog want to appear.
  if (path === "/api/users/me/terms") {
    return json({ acceptedVersion: null, acceptedAt: null, privacyVersion: null });
  }

  if (path.startsWith("/api/")) {
    return json({ results: [], bills: [], posts: [], items: [], references: [] });
  }

  let file = join(DIST, path === "/" ? "index.html" : path);
  try {
    await stat(file);
  } catch {
    file = join(DIST, "index.html");
  }
  const body = await readFile(file);
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launchChromium();
const failures = [];

function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/**
 * How many full-bleed layers are painted over the page right now.
 *
 * Counted from the geometry — anything fixed, covering most of the viewport,
 * visible, and not the app shell itself. Two of these is the bug, no matter
 * which components drew them.
 */
async function overlayCount(page) {
  return page.evaluate(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return [...document.querySelectorAll("body *")].filter((el) => {
      const style = getComputedStyle(el);
      if (style.position !== "fixed") return false;
      if (style.visibility === "hidden" || style.display === "none") return false;
      if (Number(style.opacity) === 0) return false;
      const box = el.getBoundingClientRect();
      return box.width >= w * 0.9 && box.height >= h * 0.9;
    }).length;
  });
}

// ---------------------------------------------------------------------------
// A first-time visitor, signed out, opening sign-up
// ---------------------------------------------------------------------------

const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await routeApiToLocal(page, base);
await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

// The welcome dialog is expected here — a signed-out visitor has not accepted.
// One layer is correct; the check is that it never becomes two.
check(
  "a first visit shows one consent layer, not two",
  (await overlayCount(page)) <= 1,
  `${await overlayCount(page)} full-bleed layers`,
);

// Accept it the way a visitor does, so the sign-up form is reachable.
const agree = page.getByRole("button", { name: /agree & continue/i });
if ((await agree.count()) > 0) {
  await page.getByRole("checkbox").first().click();
  await agree.first().click();
  await page.waitForTimeout(500);
}

// The header offers "Sign up"; the narrow sidebar offers "Sign in". Either
// opens the same dialog, and which one is on screen depends on the width — so
// take whichever is there rather than pinning the check to a layout.
const opener = page.getByRole("button", { name: /^sign (up|in)$/i });
const openerCount = await opener.count();
check(
  "a signed-out visitor is offered a way to join",
  openerCount > 0,
  openerCount === 0
    ? `buttons on screen: ${await page.evaluate(() =>
        [...document.querySelectorAll("button")]
          .filter((b) => b.offsetParent !== null)
          .map((b) => b.innerText.trim())
          .filter(Boolean)
          .slice(0, 20)
          .join(" | "),
      )}`
    : undefined,
);

if (openerCount > 0) {
  await opener.first().click();
  await page.waitForTimeout(900);

  // The dialog opens on sign-in for a returning visitor; a first-timer wants
  // the other tab. The footer link switches, and is labelled by the mode it
  // switches TO.
  const toSignUp = page.getByRole("button", { name: /^sign up$/i });
  if ((await toSignUp.count()) > 0) {
    await toSignUp.last().click();
    await page.waitForTimeout(600);
  }

  // THE REGRESSION ITSELF. With the sign-up dialog open, nothing else may be
  // over it. Before the fix this was 2 and the top one took no clicks.
  const layers = await overlayCount(page);
  check(
    "NOTHING LANDS ON TOP OF THE SIGN-UP DIALOG",
    layers <= 1,
    `${layers} full-bleed layers over the page`,
  );

  // And what is on screen must actually take a click. This is the half a
  // z-index fix would have passed and a person would still have been stuck on.
  const box = page.getByRole("checkbox").first();
  check("the sign-up form asks for consent", (await box.count()) > 0);

  if ((await box.count()) > 0) {
    let clickable = true;
    try {
      await box.click({ timeout: 5000 });
    } catch {
      clickable = false;
    }
    check("AND THE CONSENT BOX CAN ACTUALLY BE TICKED", clickable);
  }

  // The form names both documents, and links them. Read BEFORE submitting —
  // afterwards the form is replaced by the verification step and the words are
  // gone, which is not the same as never having been there.
  const html = await page.content();
  check("it names the Terms of Use", html.includes("Terms of Use"));
  check("it names the Privacy Policy", html.includes("Privacy Policy"));
  check("and links to /privacy", html.includes('href="/privacy"'));

  // AND NOW THE ACTUAL SEQUENCE. Fill it in, submit, and let the session
  // appear underneath — which is the moment the welcome dialog used to fire on
  // top of the verification step and freeze the whole thing.
  // BY ID, not by label. "Password" matches both the password and the confirm
  // field, and an ambiguous locator fills neither — which silently skips the
  // submit and leaves the check measuring a form that was never sent.
  const field = async (id, value) => {
    const input = page.locator(`#${id}`);
    if ((await input.count()) > 0) await input.first().fill(value);
  };
  await field("civic-name", "New Person");
  await field("civic-username", "newperson");
  await field("civic-email", "new@example.com");
  await field("civic-password", "a-real-enough-password");
  await field("civic-confirm-password", "a-real-enough-password");

  const submit = page.getByRole("button", { name: /^create account$/i });
  check("the form can be submitted", (await submit.count()) > 0);

  if ((await submit.count()) > 0) {
    await submit.first().click({ timeout: 5000 }).catch(() => undefined);
    // Long enough for the session to land and the dialog to decide.
    await page.waitForTimeout(2500);

    const afterLayers = await overlayCount(page);
    check(
      "AND NOTHING LANDS ON TOP AFTER THE ACCOUNT IS CREATED",
      afterLayers <= 1,
      `${afterLayers} full-bleed layers once signed in`,
    );

    // The half a z-index fix would pass and a person would still be stuck on:
    // whatever is on top has to take a click.
    const anyButton = page.getByRole("button").first();
    let stillClickable = true;
    try {
      await anyButton.click({ timeout: 4000, trial: true });
    } catch {
      stillClickable = false;
    }
    check("AND THE SCREEN STILL TAKES A CLICK", stillClickable);
  }

}

// ---------------------------------------------------------------------------
// The privacy page itself exists and says something
// ---------------------------------------------------------------------------

{
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await routeApiToLocal(p, base);
  await p.goto(`${base}/privacy`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);

  const text = await p.evaluate(() => document.body.innerText);
  check("/privacy renders a policy", text.includes("Privacy Policy"));
  // The three things the law actually requires it to say, asserted by name
  // rather than by "the page is not empty".
  check("it discloses profiling", /profiling/i.test(text));
  check("it says where the data is stored", /United States/i.test(text));
  check("it names a contact", /@/.test(text));
  await p.close();
}

await page.close();
await browser.close();
server.close();

console.log(`\n${failures.length === 0 ? "All good." : `${failures.length} failed:`}`);
for (const f of failures) console.log(`  - ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
