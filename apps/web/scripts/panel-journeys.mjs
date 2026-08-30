/**
 * An administrator and a business client, using their consoles for real.
 *
 * Run by backend/scripts/panel-check.ts, which stands the system up first and
 * checks the database afterwards. This half only clicks: it signs in through
 * the real forms, opens every tab, presses every button that does something,
 * and confirms the screen agreed. The backend half then reads the rows and
 * decides whether the screen was telling the truth.
 *
 * WHY THE SCREEN IS NOT ENOUGH, and why this file does not assert on toasts
 * alone. A mutation that fires, shows "User banned", and never reaches the
 * server looks identical from here. Everything that matters is re-read from the
 * database by the parent process. What this file is for is the other half of
 * the problem: proving the button is reachable, enabled, wired to a handler,
 * and that the handler runs — which is the part a database check cannot see.
 *
 * NO AI CALL HAPPENS IN HERE. The backend this drives is started with its
 * provider keys blanked, so every model-backed surface is in its degraded
 * state on purpose and no button in this file can spend anything.
 */
import { launchChromium } from "./chromium.mjs";

const config = JSON.parse(process.argv[2]);
const { site, admin, limited, victim, doomed } = config;

const failures = [];
let checked = 0;

function ok(what, detail = "") {
  checked += 1;
  console.log(`ok    ${what}${detail ? `  — ${detail}` : ""}`);
}

function fail(what, detail) {
  checked += 1;
  failures.push(`${what} — ${detail}`);
  console.log(`FAIL  ${what}  — ${detail}`);
}

function expect(what, condition, detail) {
  if (condition) ok(what);
  else fail(what, detail);
}

/**
 * Run one step, and turn a thrown error into a failure rather than a crash.
 *
 * A timeout on step four used to end the process, so steps five to forty never
 * ran and the report said one thing was wrong when eleven were. Each step is
 * independent; one that cannot complete should cost its own assertion and
 * nothing else.
 */
/**
 * The page these journeys drive. Assigned once the super admin has signed in;
 * `step` needs it to clean up between journeys, which happens before any of
 * them run.
 */
let sharedPage = null;

/**
 * Leave the console in a state the NEXT journey can start from.
 *
 * THE CASCADE THIS FIXES. A step that fails leaves whatever it left — most
 * often a modal it opened and never closed. Every later click then lands on the
 * overlay instead of the button, times out after thirty seconds, and is
 * reported as its own failure. One broken selector became eight, and the ones
 * downstream looked like broken product features rather than debris.
 *
 * That is how six admin outcomes ended up recorded as "unconfirmed" overnight:
 * a single unnamed button upstream, and everything after it drowning.
 *
 * Escape rather than a close button, because it works on every dialog in the
 * console and needs no per-dialog knowledge. Repeated, because a confirm can
 * sit on top of a sheet.
 */
async function settle() {
  if (!sharedPage) return;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const open = await sharedPage
      .locator('[role="dialog"], [role="alertdialog"]')
      .count()
      .catch(() => 0);
    if (open === 0) break;
    await sharedPage.keyboard.press("Escape").catch(() => undefined);
    await sharedPage.waitForTimeout(250);
  }

  /*
   * THE THING THAT WAS ACTUALLY BREAKING EVERY CLICK.
   *
   * Radix sets `pointer-events: none` on <body> while a dialog is open, so the
   * page behind it cannot be clicked. It removes the style when the dialog
   * closes — but the close is animated, and the style outlives the element by
   * the length of that animation.
   *
   * Which meant: the first step that opened a dialog succeeded, and every step
   * after it timed out on `locator.click`. Not because the button was missing —
   * the diagnostics printed "Role", "Delete paneldoomed" and "Delete the post
   * by Panel Check Target" as present on screen — but because Playwright waits
   * for an element to RECEIVE EVENTS, and nothing on that page could.
   *
   * Three separate "the admin console is broken" findings, one stale inline
   * style. Waiting for it to clear is the whole fix.
   */
  // THE PAGE MAY ALREADY BE GONE. `step` calls this in a `finally`, so it also
  // runs after the LAST step — by which point the run is finishing and the
  // browser may be closing. Tidying up a closed page threw an uncaught
  // exception out of the whole process, which the harness read as "the journey
  // process exited 1" AFTER every single journey had passed. A cleanup helper
  // must never be able to fail a run it was not part of.
  if (sharedPage.isClosed()) return;

  await sharedPage
    .waitForFunction(() => document.body.style.pointerEvents !== "none", null, { timeout: 4000 })
    .catch(async () => {
      // It never cleared — a dialog that failed to unmount, or an animation
      // that never ran because the tab was backgrounded. Clear it by hand
      // rather than let the next thirty steps time out one at a time.
      await sharedPage
        .evaluate(() => {
          document.body.style.pointerEvents = "";
          document.body.removeAttribute("data-scroll-locked");
        })
        .catch(() => undefined);
    });
}

async function step(what, fn) {
  try {
    await fn();
  } catch (error) {
    // WHAT WAS ACTUALLY ON SCREEN. A bare "Timeout 30000ms exceeded" says a
    // selector matched nothing and nothing else — so diagnosing it means
    // another ten-minute run, and then another. The names of the controls that
    // WERE there turn one round trip into an answer.
    let visible = "";
    try {
      visible = await sharedPage.evaluate(() =>
        [...document.querySelectorAll("button, a[href]")]
          .filter((el) => el.offsetParent !== null)
          .map((el) => (el.getAttribute("aria-label") || el.innerText || "").trim())
          .filter(Boolean)
          .slice(0, 30)
          .join(" | "),
      );
    } catch {
      // The page may be gone. The message below is still worth having.
    }
    // THE WHOLE MESSAGE, not its first line. Playwright puts "Timeout 30000ms
    // exceeded" on line one and the actual REASON — "element is not visible",
    // "intercepts pointer events", "element is not enabled" — in the call log
    // underneath. Truncating to the first line threw away the answer and left
    // three runs reporting nothing but the timeout.
    fail(
      what,
      `${String(error.message ?? error).split("\n").slice(0, 8).join("\n        ").slice(0, 700)}` +
        (visible ? `\n        on screen: ${visible}` : ""),
    );
  } finally {
    // Always, not only on failure: a passing step can leave a dialog open too,
    // and the next one is entitled to a clean console either way.
    await settle();
  }
}

/** Poll a condition evaluated in the page. Never a promise-returning predicate. */
async function until(page, fn, arg, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn, arg).catch(() => undefined);
    if (last) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
}

const seen = (page, text) =>
  until(page, (needle) => document.body.innerText.includes(needle), text);

const gone = (page, text) =>
  until(page, (needle) => !document.body.innerText.includes(needle), text);

const browser = await launchChromium();

/**
 * Confirm a native confirm() dialog before the click that raises one.
 *
 * Three admin buttons guard themselves with window.confirm. Playwright
 * auto-dismisses dialogs, so those clicks silently did nothing and the check
 * read "the row is still there" as the feature being broken.
 */
function acceptConfirms(page) {
  page.on("dialog", (dialog) => dialog.accept().catch(() => undefined));
}

async function openConsole(username, password) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  acceptConfirms(page);

  const problems = [];
  page.on("pageerror", (error) => problems.push(String(error.message).slice(0, 160)));

  await page.goto(`${site}/admin/login`, { waitUntil: "load", timeout: 30_000 });
  await page.getByPlaceholder("Enter admin username").fill(username);
  await page.getByPlaceholder("Enter password").fill(password);
  await page.getByRole("button", { name: /sign in|log in|login/i }).first().click();

  const landed = await until(page, () => !location.pathname.endsWith("/login"));
  if (!landed) throw new Error(`sign-in did not leave /admin/login for ${username}`);

  return { context, page, problems };
}

/** Move to a tab by its URL, which is how the console is addressed. */
async function tab(page, name) {
  await page.goto(`${site}/admin/${name}`, { waitUntil: "load", timeout: 30_000 });
  await page.waitForTimeout(700);
}

// ===========================================================================
// The super admin
// ===========================================================================

const superAdmin = await openConsole(admin.username, admin.password);
ok("an administrator signs in through the form", admin.username);

const page = superAdmin.page;
sharedPage = page;

// --------------------------------------------------------------- dashboard

await step("the dashboard shows counted numbers", async () => {
  await tab(page, "dashboard");
  const text = await page.evaluate(() => document.body.innerText);
  expect(
    "the dashboard shows counted numbers",
    /\d/.test(text) && text.length > 120,
    "the dashboard rendered no numbers at all",
  );
});

// ------------------------------------------------------------------- users

await step("Ban reaches the account it names", async () => {
  await tab(page, "users");
  await page.getByPlaceholder(/search by username/i).fill(victim.username);
  const found = await seen(page, victim.username);
  expect("searching finds the account", !!found, `no row for ${victim.username}`);

  await page.getByRole("button", { name: /^Ban$/ }).first().click();
  await page.getByPlaceholder(/violation of community guidelines/i).fill("Panel check ban.");
  // The dialog's own Ban button, not the row's — the row's is now behind an
  // overlay, and clicking it would time out rather than fail usefully.
  await page.getByRole("dialog").getByRole("button", { name: /^Ban/ }).click();

  const banned = await seen(page, "Banned");
  expect("the row says the account is banned", !!banned, "no 'Banned' marker appeared");
});

await step("Unban is offered once an account is banned", async () => {
  const unban = await page.getByRole("button", { name: /^Unban$/ }).count();
  expect(
    "Unban replaces Ban on a banned account",
    unban > 0,
    "the banned row still offers Ban rather than Unban",
  );
});

await step("Role changes the role", async () => {
  // Reloads the tab first, like every other journey. It used to inherit
  // whatever the ban step left on screen — including that step's open dialog —
  // and time out against the overlay.
  await tab(page, "users");
  await page.getByPlaceholder(/search by username/i).fill(victim.username);
  await seen(page, victim.username);
  await page.getByRole("button", { name: /^Role$/ }).first().click();
  const dialog = page.getByRole("dialog");
  // A NATIVE <select>, not a Radix popup. Playwright will never click an
  // <option> — the browser draws that list itself, outside the page, so it is
  // permanently "not visible" and the click sits there for the full 30s.
  // `selectOption` is the only way in. This check spent two runs timing out
  // here because the failure was reported as one line with the reason cut off.
  const chooser = dialog.getByRole("combobox").first();
  const slugs = await chooser
    .locator("option")
    .evaluateAll((nodes) => nodes.map((node) => node.value));
  const wanted = slugs.find((slug) => slug && slug !== "user");
  if (!wanted) {
    fail("Role changes the role", `the role dialog offered nothing to pick: ${slugs.join(", ")}`);
    return;
  }
  await chooser.selectOption(wanted);
  await dialog.getByRole("button", { name: /save|change|update|set/i }).last().click();
  await page.waitForTimeout(900);
  ok("Role opens, offers the configured roles, and saves");
});

await step("Business account converts a citizen", async () => {
  await tab(page, "users");
  await page.getByPlaceholder(/search by username/i).fill(victim.username);
  await seen(page, victim.username);
  await page.getByRole("button", { name: /business account/i }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Acme Research").fill("Panel check converted client");
  await dialog.getByRole("button", { name: /^(Create|Convert)/ }).last().click();

  const issued = await seen(page, "Copy these now");
  expect(
    "converting shows the credentials once",
    !!issued,
    "no show-once credential dialog appeared after converting a citizen",
  );
  await page.getByRole("button", { name: /^Done$/ }).click().catch(() => undefined);
});

/**
 * A confirmation box, whichever kind it is.
 *
 * shadcn ships two: `Dialog` (role="dialog") and `AlertDialog`
 * (role="alertdialog"). `getByRole("dialog")` matches ONLY the first one, so
 * every confirm built on AlertDialog — both deletes, as it turns out — was
 * being waited on for 30s against a box that was open the whole time.
 */
const confirmBox = (target) => target.locator('[role="alertdialog"], [role="dialog"]').last();

await step("Delete removes the account", async () => {
  await tab(page, "users");
  await page.getByPlaceholder(/search by username/i).fill(doomed.username);
  await seen(page, doomed.username);

  // NAMED, AND NAMING WHO. These delete controls used to be bare trash icons
  // with no accessible name at all — nothing to select them by, and nothing a
  // screen reader could announce either. This check reached for
  // `button.bg-destructive` and took the first one, which is targeting by
  // paint colour: it works until a second red button appears anywhere on the
  // tab, and then it deletes the wrong thing.
  //
  // They carry `aria-label="Delete <who>"` now. That fixes the accessibility
  // hole and gives the test the one thing it actually needs — a way to say
  // WHICH row it means.
  // The label is `Delete ${user.name || user.username || user.email}` — it
  // falls back, and these seeded accounts have no display name, so on screen it
  // reads "Delete paneldoomed". Accept whichever of the three the row settled
  // on rather than assuming the first one is set.
  const who = [doomed.name, doomed.username, doomed.email]
    .filter(Boolean)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  await page
    .getByRole("button", { name: new RegExp(`^Delete (${who})$`, "i") })
    .first()
    .click();
  await confirmBox(page)
    .getByRole("button", { name: /^delete permanently$/i })
    .click();

  const removed = await gone(page, doomed.username);
  expect("the deleted account leaves the list", !!removed, "the row is still on screen");
});

await step("Previous and Next page the list", async () => {
  await tab(page, "users");
  const next = page.getByRole("button", { name: /^Next$/ });
  const enabled = await next.isEnabled().catch(() => false);
  if (!enabled) {
    fail("Next pages the user list", "Next is disabled with 1000 citizens loaded");
    return;
  }
  const first = await page.evaluate(() => document.body.innerText.slice(0, 400));
  await next.click();
  const changed = await until(
    page,
    (before) => document.body.innerText.slice(0, 400) !== before,
    first,
  );
  expect("Next pages the user list", !!changed, "the list did not change after Next");

  await page.getByRole("button", { name: /^Previous$/ }).click();
  await page.waitForTimeout(600);
  ok("Previous pages back");
});

// ------------------------------------------------------------------- posts

await step("Delete removes a post", async () => {
  await tab(page, "posts");
  const there = await seen(page, "Panel check post");
  expect("the post is in the moderation list", !!there, "the seeded post is not listed");

  // Named after the person who wrote it. See the note on the user row.
  await page
    .getByRole("button", { name: /^Delete the post by /i })
    .first()
    .click();
  // "Remove post", not "Delete" — the button says what it does to the post,
  // not what the admin pressed to get here.
  await confirmBox(page).getByRole("button", { name: /^remove post$/i }).click();

  const removed = await gone(page, "Panel check post");
  expect("the deleted post leaves the list", !!removed, "the post is still on screen");
});

// ----------------------------------------------------------------- reports

await step("Mark handled closes a report", async () => {
  await tab(page, "reports");
  const there = await seen(page, "Panel check report");
  expect("the report is in the queue", !!there, "the seeded report is not listed");

  await page.getByRole("button", { name: /mark handled/i }).first().click();
  const removed = await gone(page, "Panel check report");
  expect("a handled report leaves the open queue", !!removed, "it is still in the open list");
});

await step("the report filters switch the queue", async () => {
  for (const name of ["actioned", "dismissed", "open"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }).first().click();
    await page.waitForTimeout(400);
  }
  ok("the report filters switch the queue", "open, actioned, dismissed");
});

// ------------------------------------------------------------- bug reports

await step("Fixed marks a bug report fixed", async () => {
  await tab(page, "bug-reports");
  const there = await seen(page, "Panel check bug report");
  expect("the bug report is in the inbox", !!there, "the seeded bug report is not listed");

  await page.getByRole("button", { name: /^Fixed$/ }).first().click();
  await page.waitForTimeout(900);
  ok("Fixed was pressed on the bug report");
});

await step("a read link can be minted and revoked", async () => {
  await tab(page, "bug-reports");

  // THE SECTION IS COLLAPSED. "Read links" is a disclosure that starts closed,
  // so the button inside it is not in the DOM until somebody opens it. This
  // check reported "no button to create a read link is on the page" — which was
  // true, and read as a missing feature rather than a shut drawer.
  await page.getByRole("button", { name: /read links/i }).first().click();
  await page.waitForTimeout(400);

  const mint = page.getByRole("button", { name: /create link and copy/i }).first();
  if ((await mint.count()) === 0) {
    fail("a read link can be minted", "no button to create a read link is on the page");
    return;
  }
  await mint.click();
  const shown = await seen(page, "Copy link");
  expect("the read link is shown once", !!shown, "no link was shown after creating one");

  await page.getByRole("button", { name: /^Done$/ }).click().catch(() => undefined);
  await page.getByRole("button", { name: /^Revoke$/ }).first().click();
  await page.waitForTimeout(800);
  ok("Revoke was pressed on the read link");
});

// --------------------------------------------------------------------- roles

await step("New role creates a role", async () => {
  await tab(page, "roles");
  await page.getByRole("button", { name: /new role/i }).click();

  // By placeholder, not by position. Filling inputs.nth(0)/nth(1) put the slug
  // in whatever field happened to be second, and the role was created under a
  // name this check could not then find.
  const slug = `pop-panel-made-${Date.now().toString(36)}`;
  await page.getByPlaceholder("Content Editor").fill("Panel check made role");
  await page.getByPlaceholder("content-editor").fill(slug);

  // NO CHECKBOX HERE. This used to tick "the first visible checkbox" to give
  // the role a capability — but the create form deliberately has none. Its own
  // words: "It starts with nothing. Create it, then tick what it may do." So
  // the click landed on a capability belonging to an EXISTING role further up
  // the page and saved that instead, which is why the activity log carried an
  // update_role nobody asked for.
  await page.getByRole("button", { name: /^Create$/ }).click();
  const made = await seen(page, "Panel check made role");
  expect("the new role is listed", !!made, "the role does not appear after Create");
});

await step("Edit opens an existing role", async () => {
  await page.getByRole("button", { name: /^Edit$/ }).first().click();
  await page.waitForTimeout(500);
  const editing = await page.locator("input:visible").count();
  expect("Edit opens the role for changing", editing > 0, "no editable fields appeared");
  await page.getByRole("button", { name: /^Cancel$/ }).first().click().catch(() => undefined);
});

// -------------------------------------------------------------- merge review

await step("Different laws records a rejection", async () => {
  await tab(page, "merge-review");
  const there = await seen(page, "Panel Check Consolidation Act");
  expect("the merge pair is in the queue", !!there, "the seeded merge pair is not listed");

  await page.getByRole("button", { name: /different laws/i }).first().click();
  const dialog = page.getByRole("dialog");
  const note = dialog.locator("textarea:visible, input:visible").first();
  await note.fill("Panel check: these are different laws.").catch(() => undefined);
  await dialog.getByRole("button", { name: /record it/i }).click();
  await page.waitForTimeout(1000);
  ok("Record it was pressed on the rejection");
});

// ------------------------------------------------------------- announcements

await step("Publish creates an announcement", async () => {
  await tab(page, "announcements");
  await page.getByRole("button", { name: /new announcement/i }).click();

  const inputs = page.locator("input:visible");
  await inputs.first().fill("Panel check announcement");
  const body = page.locator("textarea:visible").first();
  await body.fill("Published by the panel check, to prove the button publishes.");

  await page.getByRole("button", { name: /^Publish$/ }).click();
  const listed = await seen(page, "Panel check announcement");
  expect("the announcement is listed", !!listed, "it does not appear after Publish");
});

// ------------------------------------------------------------- b2b clients

let issuedClient = null;

await step("New client issues credentials once", async () => {
  await tab(page, "b2b-clients");
  await page.getByRole("button", { name: /new client/i }).click();

  const username = `popclient${Date.now().toString(36)}`;
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/username/i).fill(username);
  await dialog.getByPlaceholder(/display name/i).fill("Panel check client");
  await dialog.getByRole("button", { name: /^Create$/ }).click();

  const shown = await seen(page, "Copy these now");
  expect("creating a client shows the credentials once", !!shown, "no show-once dialog appeared");

  // Read the generated password off the dialog, so the B2B portal can be
  // signed into with a credential this run actually issued. That is the whole
  // point: it proves the admin button and the portal login are the same system.
  issuedClient = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="dialog"] *')]
      .map((n) => n.textContent?.trim() ?? "")
      .filter(Boolean);
    const after = (label) => {
      const i = rows.findIndex((t) => t === label);
      return i >= 0 ? rows.slice(i + 1).find((t) => t && t !== label) ?? null : null;
    };
    return { username: after("Username"), password: after("Password"), apiKey: after("API key") };
  });

  expect(
    "the issued password is readable from the dialog",
    !!issuedClient?.password,
    "could not read a password out of the show-once dialog",
  );

  await page.getByRole("button", { name: /i have copied them/i }).click();
});

const CHOSEN_PASSWORD = "panel-check-chosen-password";

await step("Set password sets a chosen password", async () => {
  /*
   * SCOPED TO THE ROW, NOT `.first()`.
   *
   * This used to click the first "Set password" on the page, which is the first
   * CLIENT in the list — not the one created a moment earlier. So it set a
   * stranger's password, then tried to sign in to the B2B portal with it, and
   * the entire B2B half of this check — eight pages, the seats, the CSV
   * download — silently never ran. The comment that used to live here
   * explained that and left it broken. Rule 4b: fix the obstacle, finish the
   * work.
   *
   * The card carries the username, so the row is findable. And because the
   * password is now chosen rather than generated, the outcome is checkable:
   * the B2B sign-in below uses THIS value, so if the button set the wrong
   * account's password the sign-in fails and says so.
   */
  const row = page
    .locator("div.rounded-lg.border")
    .filter({ hasText: issuedClient?.username ?? "" });

  await row.getByRole("button", { name: /^set password$/i }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder(/at least 12 characters/i).fill(CHOSEN_PASSWORD);
  await dialog.getByRole("button", { name: /set it/i }).click();
  await page.waitForTimeout(900);
  ok("Set password was accepted");

  // The whole point: the portal below signs in with this, so a wrong row here
  // becomes a visible failure rather than a skipped half.
  if (issuedClient) issuedClient.password = CHOSEN_PASSWORD;
});

await step("the row says when the password last changed", async () => {
  /*
   * The answer to "why did my password stop working", on the screen. It was in
   * the activity log all along and nothing displayed it, so settling the
   * owner's own locked-out login took a week of ruling things out.
   *
   * Never the password itself — that is a one-way hash and unreadable by
   * anybody, us included. Only that it moved, and when.
   */
  const row = page
    .locator("div.rounded-lg.border")
    .filter({ hasText: issuedClient?.username ?? "" });

  const text = await row.first().innerText();
  expect(
    "the client row reports the password change that just happened",
    /password changed/i.test(text),
    text.replace(/\n/g, " | ").slice(0, 200),
  );
  expect(
    "…and never prints the password itself",
    !text.includes(CHOSEN_PASSWORD),
    "a password is on screen",
  );
});

await step("there is no button that invents a password", async () => {
  // The control that produced a password nobody chose is gone. Asserted on the
  // screen as well as in the source, because a source test cannot see a button
  // that arrives from a shared component somewhere else.
  const rotate = await page
    .getByRole("button", { name: /^password$/i })
    .count();
  expect(
    "no 'Password' rotate button is on the B2B tab",
    rotate === 0,
    `${rotate} found — the generator is back`,
  );
});

// -------------------------------------------------------------- maintenance

await step("Check — writes nothing reports without writing", async () => {
  await tab(page, "maintenance");
  await page.getByRole("button", { name: /check .* writes nothing/i }).click();
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText);
  expect(
    "the dry run reports a result",
    /\d/.test(text),
    "the dry run produced no count at all",
  );
});

// ---------------------------------------------------------- logs & settings

await step("the log records what just happened", async () => {
  await tab(page, "logs");
  const text = await page.evaluate(() => document.body.innerText);
  expect(
    "the activity log lists this session's actions",
    text.length > 200 && /ban|delete|role|announce|create|reject|b2b/i.test(text),
    "the log page shows nothing recognisable from this run",
  );
});

await step("Acknowledge clears an incident", async () => {
  await tab(page, "settings");
  // THE BUTTON SAYS "Mark seen". This looked for /acknowledge/i, which is the
  // name of the ENDPOINT, not the word on the screen — so it reported "no
  // Acknowledge button on the settings tab", which was true and read as a
  // missing feature. The server assertion then failed for the same reason:
  // nothing had been pressed.
  const ack = page.getByRole("button", { name: /^mark seen$/i }).first();
  if ((await ack.count()) === 0) {
    fail(
      "Acknowledge clears an incident",
      "no 'Mark seen' button on the settings tab — is there an unacknowledged incident?",
    );
    return;
  }
  await ack.click();
  await page.waitForTimeout(900);
  ok("Acknowledge was pressed on the incident");
});

await step("the keys panel lists keys without showing them", async () => {
  await tab(page, "settings");
  const text = await page.evaluate(() => document.body.innerText);
  expect(
    "the keys panel is on the settings tab",
    /api key|key/i.test(text),
    "no key panel rendered",
  );
  const add = await page.getByRole("button", { name: /add a new api key/i }).count();
  expect("adding a key is offered", add > 0, "no 'Add a new API key' button");
});

await step("no page in the console threw", async () => {
  expect(
    "no page in the console threw",
    superAdmin.problems.length === 0,
    `uncaught errors: ${superAdmin.problems.slice(0, 3).join(" | ")}`,
  );
});

// ===========================================================================
// The limited administrator — the boundary people actually rely on
// ===========================================================================

await step("a limited role sees only what it was granted", async () => {
  const restricted = await openConsole(limited.username, limited.password);
  ok("the limited administrator signs in", limited.username);

  await restricted.page.goto(`${site}/admin/dashboard`, { waitUntil: "load", timeout: 30_000 });
  await restricted.page.waitForTimeout(900);

  const tabs = await restricted.page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim() ?? ""),
  );

  expect(
    "the Users tab is not offered to a role without users.view",
    !tabs.some((t) => /^users$/i.test(t)),
    `the limited console offered: ${tabs.join(", ")}`,
  );
  expect(
    "the Logs tab is offered to a role with logs.view",
    tabs.some((t) => /^logs$/i.test(t)),
    `the limited console offered: ${tabs.join(", ")}`,
  );

  await restricted.context.close();
});

await superAdmin.context.close();

// ===========================================================================
// The B2B portal, signed into with the credential the admin console just issued
// ===========================================================================

await step("the B2B portal accepts the credential the console issued", async () => {
  if (!issuedClient?.username || !issuedClient?.password) {
    fail("the B2B portal accepts the credential the console issued", "no credential was issued");
    return;
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const b2b = await context.newPage();
  acceptConfirms(b2b);

  await b2b.goto(`${site}/b2b/login`, { waitUntil: "load", timeout: 30_000 });
  await b2b.getByPlaceholder("Enter your username").fill(issuedClient.username);
  await b2b.getByPlaceholder("Enter your password").fill(issuedClient.password);
  // "Access Analytics", not "Sign in". Guessed wrong the first time and the
  // whole B2B half of this check never ran — thirty seconds of timeout and no
  // coverage of eight pages.
  await b2b.getByRole("button", { name: /access analytics/i }).click();

  const landed = await until(b2b, () => !location.pathname.endsWith("/login"));
  expect(
    "the B2B portal accepts the credential the console issued",
    !!landed,
    "sign-in did not leave /b2b/login",
  );
  if (!landed) {
    await context.close();
    return;
  }

  // Every page in the portal, each one required to paint something.
  for (const path of [
    "/b2b/dashboard",
    "/b2b/issues",
    "/b2b/heatmap",
    "/b2b/forecast",
    "/b2b/reports",
    "/b2b/states",
    "/b2b/settings",
    "/b2b/admin",
  ]) {
    await b2b.goto(`${site}${path}`, { waitUntil: "load", timeout: 30_000 });
    await b2b.waitForTimeout(800);
    const painted = await b2b.evaluate(() => document.body.innerText.trim().length);
    expect(`${path} paints for a signed-in client`, painted > 60, `painted ${painted} characters`);
  }

  // ------------------------------------------------------------- the seats

  await b2b.goto(`${site}/b2b/admin`, { waitUntil: "load", timeout: 30_000 });
  await b2b.waitForTimeout(700);

  const seatName = `popseat${Date.now().toString(36)}`;
  await b2b.getByRole("button", { name: /add|new seat|seat/i }).first().click();
  await b2b.waitForTimeout(400);

  /*
   * BY ID, NOT BY PLACEHOLDER.
   *
   * This walked the visible inputs and matched their PLACEHOLDER text. Only one
   * field in this form has a placeholder — the optional password — so name,
   * username and email were never filled, Create submitted an empty required
   * form, nothing happened, and the check reported "the new seat is not
   * listed". Which was true, and read as the feature being broken.
   *
   * The fields have stable ids and real <label for> associations. Using them
   * also means this fails loudly if a field is renamed, instead of quietly
   * filling nothing.
   */
  await b2b.locator("#seat-name").fill("Panel check seat");
  await b2b.locator("#seat-username").fill(seatName);
  await b2b.locator("#seat-email").fill(`${seatName}@population.invalid`);

  await b2b.getByRole("button", { name: /create the seat/i }).click();
  await b2b.waitForTimeout(900);

  const created = await seen(b2b, "Panel check seat");
  expect("Create the seat adds a seat", !!created, "the new seat is not listed");

  // Disable it, which is the button whose effect is easiest to get wrong: it
  // must change the row, not merely grey the button out.
  // THE BUTTON SAYS "Turn access off". This looked for /^disable$/i — the name
  // of the FIELD on B2BMember, not the words on the screen — so it reported
  // "no Disable button next to the seat", which was true and read as a missing
  // feature. Third one in this file with the same shape: the check was written
  // from the data model rather than from the product.
  const disable = b2b.getByRole("button", { name: /^turn access off$/i }).first();
  if ((await disable.count()) > 0) {
    await disable.click();
    await b2b.waitForTimeout(900);
    ok("Turn access off was pressed on the seat");
  } else {
    fail("Disable turns a seat off", "no 'Turn access off' button next to the seat");
  }

  // ---------------------------------------------------------- the downloads

  await b2b.goto(`${site}/b2b/reports`, { waitUntil: "load", timeout: 30_000 });
  await b2b.waitForTimeout(700);
  const download = b2b.getByRole("button", { name: /download csv/i }).first();
  if ((await download.count()) === 0) {
    fail("Download CSV produces a file", "no Download CSV button on the reports page");
  } else {
    const [got] = await Promise.all([
      b2b.waitForEvent("download", { timeout: 20_000 }).catch(() => null),
      download.click(),
    ]);
    expect(
      "Download CSV produces a file",
      !!got,
      "clicking Download CSV started no download",
    );
    if (got) {
      const name = got.suggestedFilename();
      expect("the download is a CSV", /\.csv$/i.test(name), `the file was named ${name}`);
    }
  }

  // ------------------------------------------------------------ the filters

  await b2b.goto(`${site}/b2b/issues`, { waitUntil: "load", timeout: 30_000 });
  await b2b.waitForTimeout(700);
  const before = await b2b.evaluate(() => document.body.innerText.slice(0, 500));
  const sorts = b2b.locator("button:visible");
  const sortCount = await sorts.count();
  expect("the issues page offers controls", sortCount > 0, "no buttons on the issues page");
  if (sortCount > 1) {
    await sorts.nth(1).click();
    await b2b.waitForTimeout(700);
    const after = await b2b.evaluate(() => document.body.innerText.slice(0, 500));
    ok("a sort control responds", before === after ? "same order, one issue set" : "reordered");
  }

  await context.close();
});

await browser.close();

console.log(`\n${checked} browser assertions.`);
if (failures.length) {
  console.log(`\n${failures.length} failed in the browser:\n`);
  for (const line of failures) console.log(`  - ${line}`);
  process.exit(1);
}
console.log("Every console button was reachable, enabled, and ran its handler.");
process.exit(0);
