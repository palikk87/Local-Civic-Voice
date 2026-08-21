/**
 * The citizens, doing things, in a real browser against a real backend.
 *
 * Run by backend/scripts/system-check.ts, which stands the system up first.
 * It lives here because Playwright does, and it talks to the system only the
 * way a person does: through the site, and through the public API.
 *
 * Every assertion reads a number back from the API after the click, rather than
 * trusting what the screen shows. A page that renders an optimistic count and
 * never persists it would pass a screen-only check and fail every user.
 */
import { launchChromium } from "./chromium.mjs";

const [siteOrigin, billId, leaderEmail, followerEmail, leaderName, password, leaderId] =
  process.argv.slice(2);

const failures = [];
let checked = 0;

function ok(what, detail = "") {
  checked += 1;
  console.log(`ok    ${what}${detail ? `  — ${detail}` : ""}`);
}

function expect(what, condition, detail) {
  checked += 1;
  if (condition) {
    console.log(`ok    ${what}`);
  } else {
    failures.push(`${what} — ${detail}`);
    console.log(`FAIL  ${what}  — ${detail}`);
  }
}

/** The published Pulse, split the way Article III promises. */
async function pulse() {
  const response = await fetch(`${siteOrigin}/api/government-references/${billId}/vote-details`);
  if (!response.ok) throw new Error(`vote-details returned ${response.status}`);
  return response.json();
}

/**
 * Poll a condition from Node, evaluating it in the page.
 *
 * NOT page.waitForFunction WITH AN ASYNC PREDICATE. That resolves the moment
 * the predicate returns a Promise, because a Promise object is truthy — so
 * every wait built that way passed instantly and this check reported a citizen
 * as signed in while the session was empty. It is the second time in this
 * project a check has been wrong in the reassuring direction, which is the only
 * direction that matters.
 *
 * page.evaluate does await the promise, so polling it from here is honest.
 */
async function until(page, fn, arg, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn, arg).catch(() => undefined);
    if (last) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return undefined;
}

const browser = await launchChromium();

/**
 * A browser with one citizen signed into it.
 *
 * Signed in through the app's own form rather than by planting a cookie: the
 * sign-in path is part of what this checks, and a planted session skips it.
 */
async function asCitizen(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto(`${siteOrigin}/auth`, { waitUntil: "domcontentloaded" });

  // By id, not by input type: the sign-in field is type="text", because it
  // accepts a username as well as an address. Selecting on type looked right
  // and matched nothing.
  await page.locator("#civic-email").waitFor({ timeout: 25_000 });
  await page.locator("#civic-email").fill(email);
  await page.locator("#civic-password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const signedIn = await until(page, async () => {
    const r = await fetch("/api/auth/get-session", { credentials: "include" });
    const body = await r.json().catch(() => null);
    return Boolean(body && body.user);
  });

  if (!signedIn) {
    throw new Error(`${email} could not sign in. Screen said: ${await onScreen(page)}`);
  }

  if (process.env.SYSTEM_CHECK_DEBUG) {
    const cookies = await context.cookies();
    const probe = await page.evaluate(async () => {
      const r = await fetch("/api/auth/get-session", { credentials: "include" });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    });
    console.log(`      [debug] cookies: ${cookies.map((c) => `${c.name} path=${c.path} secure=${c.secure} sameSite=${c.sameSite} domain=${c.domain}`).join(" | ") || "(none)"}`);
    console.log(`      [debug] get-session ${probe.status}: ${probe.body}`);
  }

  return { context, page };
}

/**
 * Wait until the PAGE believes it is signed in, not just the cookie jar.
 *
 * The cookie is set the moment sign-in returns, but the app decides whether a
 * click is a vote or a prompt to sign up from React Query's session state,
 * which is refetched on every navigation. Clicking in the gap opens the auth
 * modal instead of voting — silently, since a modal is a perfectly ordinary
 * thing for a button to do. That is what made the first vote here vanish.
 */
async function signedInPage(page, who) {
  const seen = await until(
    page,
    (name) => document.getElementById("root")?.innerText.includes(name) ?? false,
    who,
  );
  if (!seen) {
    // Never fail blind. A timeout that does not say what was on the screen
    // costs a whole extra run to find out.
    throw new Error(
      `${page.url()} never showed "${who}" as signed in. Screen said: ${await onScreen(page)}`,
    );
  }
}

/** What the citizen could actually see, for when something did not work. */
async function onScreen(page) {
  return page
    .evaluate(() => document.getElementById("root")?.innerText.replace(/\s+/g, " ").slice(0, 400) ?? "")
    .catch(() => "(the page was gone)");
}

/** Wait until the published Pulse says what it should, or give up. */
async function settles(predicate, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await pulse();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

try {
  // ------------------------------------------------------------- signing in
  const one = await asCitizen(leaderEmail);
  ok("a citizen signs in through the form");
  const leaderShortName = leaderName;

  // ---------------------------------------------------------------- voting
  await one.page.goto(`${siteOrigin}/reference/${billId}`, { waitUntil: "domcontentloaded" });
  await signedInPage(one.page, leaderShortName);
  const support = one.page.getByRole("button", { name: /^support$/i }).first();
  await support.waitFor({ timeout: 25_000 });
  await support.click();

  let state = await settles((p) => p.total === 1);
  expect(
    "a vote clicked in the browser reaches the published Pulse",
    state.support.total === 1 && state.oppose.total === 0,
    `Pulse says ${state.support.total}/${state.oppose.total}`,
  );

  // ------------------------------------------------------------ delegating
  const two = await asCitizen(followerEmail);
  ok("a second citizen signs in");
  const followerName = "Citizen 0002";

  await two.page.goto(`${siteOrigin}/delegates`, { waitUntil: "domcontentloaded" });
  await signedInPage(two.page, followerName);
  const firstName = leaderName.split(" ")[0];
  const delegateButton = two.page
    .getByRole("button", { name: new RegExp(`delegate to ${firstName}`, "i") })
    .first();
  try {
    await delegateButton.waitFor({ timeout: 25_000 });
  } catch (error) {
    throw new Error(`no "Delegate to ${firstName}" button. Screen said: ${await onScreen(two.page)}`);
  }
  await delegateButton.click();

  const created = await until(two.page, async () => {
    const r = await fetch("/api/delegations/me", { credentials: "include" });
    const body = await r.json().catch(() => null);
    return Boolean(body && body.activeCount > 0);
  });
  if (!created) throw new Error(`the delegation never appeared. Screen said: ${await onScreen(two.page)}`);
  ok("delegating from the browser creates the delegation");

  state = await settles((p) => p.total === 2);
  expect(
    "the lent voice joins the Pulse at once, with nobody else voting",
    state.support.total === 2 && state.oppose.total === 0,
    `Pulse says ${state.support.total}/${state.oppose.total}`,
  );
  expect(
    "and it is visible as delegated weight, not as a second vote",
    state.support.direct === 1 && state.support.delegated === 1,
    `direct ${state.support.direct}, delegated ${state.support.delegated}`,
  );

  // --------------------------------------------------- voting over your delegate
  await two.page.goto(`${siteOrigin}/reference/${billId}`, { waitUntil: "domcontentloaded" });
  await signedInPage(two.page, followerName);
  const oppose = two.page.getByRole("button", { name: /^oppose$/i }).first();
  await oppose.waitFor({ timeout: 25_000 });
  await oppose.click();

  state = await settles((p) => p.oppose.total === 1);
  expect(
    "voting for yourself overrides your delegate",
    state.support.total === 1 && state.oppose.total === 1,
    `Pulse says ${state.support.total}/${state.oppose.total}`,
  );

  const stillDelegating = await two.page.evaluate(async () => {
    const r = await fetch("/api/delegations/me", { credentials: "include" });
    return (await r.json()).activeCount;
  });
  expect(
    "and does not cost you the delegation",
    stillDelegating === 1,
    `activeCount is ${stillDelegating}`,
  );

  // -------------------------------------------------------------- revoking
  // Withdraw the direct vote first, so what is left to observe is purely the
  // delegated weight coming back out of the count.
  await two.page.getByRole("button", { name: /^opposed$/i }).first().click();
  state = await settles((p) => p.oppose.total === 0);
  expect(
    "withdrawing your own vote hands the weight back to your delegate",
    state.support.total === 2 && state.oppose.total === 0,
    `Pulse says ${state.support.total}/${state.oppose.total}`,
  );

  await two.page.goto(`${siteOrigin}/delegates`, { waitUntil: "domcontentloaded" });
  await signedInPage(two.page, followerName);
  const revokeButton = two.page.getByRole("button", { name: /tap to revoke/i }).first();
  await revokeButton.waitFor({ timeout: 25_000 });
  await revokeButton.click();

  const revoked = await until(two.page, async () => {
    const r = await fetch("/api/delegations/me", { credentials: "include" });
    const body = await r.json().catch(() => null);
    return Boolean(body && body.activeCount === 0);
  });
  if (!revoked) throw new Error(`the delegation never went away. Screen said: ${await onScreen(two.page)}`);

  state = await settles((p) => p.total === 1);
  expect(
    "revoking takes the borrowed voice back immediately",
    state.support.total === 1 && state.oppose.total === 0,
    `Pulse says ${state.support.total}/${state.oppose.total}`,
  );

  // ------------------------------------------------------------- the social half
  //
  // Following, posting, liking, saving. Checked here because it is the half of
  // the platform that decides whether anybody comes back, and because three of
  // its notification paths turned out to be written and wired to nothing.

  // ON THEIR PROFILE, NOT THE PEOPLE LIST.
  //
  // The first version pressed the first Follow button on /people, which in a
  // thousand-citizen population is whoever happens to sort first — so it then
  // checked the wrong person's notifications and called a working feature
  // broken. Following a named person is the only version of this that means
  // anything.
  await two.page.goto(`${siteOrigin}/user/${leaderId}`, { waitUntil: "domcontentloaded" });
  await signedInPage(two.page, followerName);

  const followButton = two.page.getByRole("button", { name: /^follow$/i }).first();
  try {
    await followButton.waitFor({ timeout: 20_000 });
  } catch {
    const probe = await two.page.evaluate(async (id) => {
      const r = await fetch(`/api/users/${id}`, { credentials: "include" });
      return { status: r.status, body: (await r.text()).slice(0, 200) };
    }, leaderId);
    throw new Error(
      `no Follow button on ${leaderName}'s profile. ` +
        `/api/users/${leaderId} answered ${probe.status}: ${probe.body}. ` +
        `Screen said: ${await onScreen(two.page)}`,
    );
  }
  await followButton.click();

  const followCount = await until(two.page, async (id) => {
    const r = await fetch("/api/auth/get-session", { credentials: "include" });
    const me = (await r.json()).user;
    const f = await fetch(`/api/users/${me.id}/following`, { credentials: "include" });
    const list = (await f.json()).results ?? [];
    return list.some((u) => u.id === id) ? list.length : false;
  }, leaderId);
  expect(
    "following someone from the browser sticks",
    Boolean(followCount),
    `${leaderName} is not in the following list`,
  );

  // The person who was followed should have been told.
  const toldAboutFollow = await until(one.page, async () => {
    const r = await fetch("/api/notifications?limit=50", { credentials: "include" });
    const body = await r.json().catch(() => null);
    return Boolean(body?.notifications?.some((n) => n.type === "follow"));
  });
  expect("and the person followed is told about it", Boolean(toldAboutFollow), "no follow notification arrived");

  await one.context.close();
  await two.context.close();
} catch (error) {
  failures.push(`the journeys ran to completion — ${String(error).slice(0, 300)}`);
  console.log(`FAIL  the journeys ran to completion  — ${String(error).slice(0, 200)}`);
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} of ${checked} journey steps failed:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAll ${checked} journey steps green.`);
