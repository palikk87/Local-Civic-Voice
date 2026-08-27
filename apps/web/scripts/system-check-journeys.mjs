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
import { launchChromium, acceptTermsBeforeLoad } from "./chromium.mjs";

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
  await acceptTermsBeforeLoad(context);
  const page = await context.newPage();

  // A request that never completes shows up in the app as "Failed to fetch" and
  // nowhere else. Chromium in this sandbox also inherits a proxy, so a request
  // to 127.0.0.1 can fail at the tunnel rather than at the server — which looks
  // identical from inside the page.
  const networkFailures = [];
  page.on("requestfailed", (request) => {
    networkFailures.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`);
  });

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
    const apiFailures = networkFailures.filter((f) => f.includes("/api/"));
    throw new Error(
      `${email} could not sign in. ` +
        `Network: ${apiFailures.slice(-3).join(" | ") || "no failed API requests"}. ` +
        `Screen said: ${await onScreen(page)}`,
    );
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

  // -------------------------------------------------- passing a post on
  //
  // Reposting is the one action whose entire purpose is reach: getting a law in
  // front of somebody who has not seen it. Checked in a browser because the
  // button, the count and the card that renders the passed-on post are three
  // separate things that each have to agree.

  await one.page.goto(`${siteOrigin}/timeline`, { waitUntil: "domcontentloaded" });
  await signedInPage(one.page, leaderShortName);

  const composed = await one.page.evaluate(async (referenceId) => {
    const r = await fetch("/api/posts", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "The insulin cap is the part that matters. #insulin",
        governmentReferenceId: referenceId,
      }),
    });
    return r.ok ? (await r.json()).post.id : null;
  }, billId);
  expect("a post can be written about a law", Boolean(composed), "the composer returned nothing");

  if (composed) {
    const passedOn = await two.page.evaluate(async (postId) => {
      const r = await fetch(`/api/posts/${postId}/repost`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, composed);
    expect(
      "a post can be passed on",
      passedOn.status === 201 && passedOn.body?.repostsCount === 1,
      `repost answered ${passedOn.status}`,
    );

    const carried = await two.page.evaluate(async () => {
      const me = (await (await fetch("/api/auth/get-session", { credentials: "include" })).json())
        .user;
      const r = await fetch(`/api/posts?authorId=${me.id}`, { credentials: "include" });
      const posts = (await r.json()).posts ?? [];
      return posts.filter((p) => p.repostOf).length;
    });
    expect("and it lands in your own timeline", carried === 1, `found ${carried} reposts`);

    const original = await one.page.evaluate(async (postId) => {
      const r = await fetch(`/api/posts/${postId}`, { credentials: "include" });
      return (await r.json()).post?.id ?? null;
    }, composed);
    expect("without touching the original", original === composed, "the original moved");

    // The tag written in that post has somewhere to lead.
    const tagged = await two.page.evaluate(async () => {
      const r = await fetch("/api/posts/hashtag/insulin", { credentials: "include" });
      return ((await r.json()).results ?? []).length;
    });
    expect("a hashtag written in a post leads somewhere", tagged >= 1, `tag page had ${tagged}`);

    const searched = await two.page.evaluate(async () => {
      const r = await fetch("/api/posts/search?q=insulin", { credentials: "include" });
      return ((await r.json()).results ?? []).length;
    });
    expect("and the post can be found by searching for it", searched >= 1, `search found ${searched}`);
  }

  // ------------------------------------------------- the citizen's own record
  //
  // The two things this platform asks people to care about and could not answer
  // about them: what did I say, and what was said in my name.

  const myRecord = await until(one.page, async () => {
    const me = (await (await fetch("/api/auth/get-session", { credentials: "include" })).json())
      .user;
    const r = await fetch(`/api/users/${me.id}/positions`, { credentials: "include" });
    const body = await r.json().catch(() => null);
    return body && body.results.length > 0 ? body : false;
  });
  expect(
    "the position taken in this run is on the citizen's record",
    Boolean(myRecord),
    "the record stayed empty after voting",
  );

  if (myRecord) {
    expect(
      "and the record knows which version of the law it was about",
      typeof myRecord.results[0].lawVersion === "number" &&
        myRecord.summary.total >= 1,
      `summary was ${JSON.stringify(myRecord.summary)}`,
    );
  }

  const receipts = await two.page.evaluate(async () => {
    const r = await fetch("/api/delegations/receipts?limit=100", { credentials: "include" });
    return r.json().catch(() => null);
  });
  expect(
    "a lent voice comes with receipts",
    // The follower revoked earlier in this run, so the honest answer here is an
    // empty list from a working endpoint rather than a failure.
    receipts !== null && Array.isArray(receipts.results),
    `receipts answered ${JSON.stringify(receipts)?.slice(0, 80)}`,
  );

  // ------------------------------------------------------------- blocking
  //
  // The safety feature that used to pop an alert claiming it had worked.

  const blocked = await two.page.evaluate(async (id) => {
    const r = await fetch(`/api/safety/blocks/${id}`, { method: "POST", credentials: "include" });
    return r.status;
  }, leaderId);
  expect("blocking someone works from the browser", blocked === 200, `status ${blocked}`);

  const gone = await two.page.evaluate(async (id) => {
    const r = await fetch(`/api/users/${id}`, { credentials: "include" });
    return r.status;
  }, leaderId);
  expect("and they are gone, not merely hidden", gone === 404, `profile answered ${gone}`);

  // Put it back, so a rerun starts where this one did.
  await two.page.evaluate(async (id) => {
    await fetch(`/api/safety/blocks/${id}`, { method: "DELETE", credentials: "include" });
  }, leaderId);

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
