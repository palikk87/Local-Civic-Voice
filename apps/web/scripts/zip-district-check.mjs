/**
 * A ZIP code finds your district, and a ZIP that spans several says so.
 *
 *   bun run zip-district-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Reported plainly: "almost no one knows what their district
 * or reps are". The picker asked for a state, a district number, or a
 * representative's name — three things somebody looking for their district does
 * not have. So it now asks for the one thing everybody knows.
 *
 * FIVE THINGS ARE PINNED HERE, and each is a way this could quietly mislead:
 *
 *   1. A ZIP in one district finds it, and choosing it saves the DISTRICT.
 *   2. A ZIP across four offers all four, says so, and picks none of them.
 *      About seventeen in every hundred are like this. Choosing for somebody is
 *      how you put a person in the wrong district and never hear about it.
 *   3. The screen says where the boundaries came from and how old they are.
 *   4. A lookup that FAILS says it failed. "No district matched" is a claim
 *      about somebody's home and must never be what a broken server looks like.
 *   5. There is a way out to the House's own finder, for the one in six the ZIP
 *      cannot settle — it asks them for an address, we never do.
 *
 * And the sign-up step, which is the whole reason the map will have anybody on
 * it: it is offered, it is skippable, and skipping it still finishes sign-up.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const VINTAGE = "118th Congress district boundaries, 2020 Census";
const CENSUS =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11820_zcta520_natl.txt";

const rep = (districtId, name, party) => ({
  districtId,
  stateCode: districtId.slice(0, 2),
  stateName: districtId.startsWith("CA") ? "California" : "New York",
  district: Number(districtId.split("-")[1]),
  representative: { name, party, photoUrl: null },
});

/** Real answers, in the real shape the route returns. */
const BY_ZIP = {
  "10001": {
    districts: [rep("NY-12", "Jerrold Nadler", "Democratic")],
    spansSeveral: false,
    source: CENSUS,
    vintage: VINTAGE,
  },
  "90002": {
    districts: [
      rep("CA-43", "Maxine Waters", "Democratic"),
      rep("CA-42", "Robert Garcia", "Democratic"),
      rep("CA-37", "Sydney Kamlager-Dove", "Democratic"),
      rep("CA-44", "Nanette Barragán", "Democratic"),
    ],
    spansSeveral: true,
    source: CENSUS,
    vintage: VINTAGE,
  },
  "00000": { districts: [], spansSeveral: false, source: CENSUS, vintage: VINTAGE },
};

/** Flipped to make the lookup fail the way an unreachable one really does. */
let lookupBroken = false;
/** What the account's saved district is. Starts unset, like a new account. */
let savedDistrict = null;
/** Signed out for the sign-up run, so /auth shows the form instead of redirecting. */
let signedIn = true;

const USER = {
  id: "u1",
  name: "Test Reader",
  email: "reader@example.com",
  username: "reader",
  emailVerified: true,
};

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path.startsWith("/api/users/jurisdiction/by-zip/")) {
    if (lookupBroken) {
      return json(
        { error: "The district lookup is unavailable right now. You can still search by state." },
        503,
      );
    }
    const zip = path.split("/").pop();
    return json(BY_ZIP[zip] ?? { districts: [], spansSeveral: false, source: CENSUS, vintage: VINTAGE });
  }

  if (path === "/api/users/jurisdiction/districts") {
    return json({
      districts: [...BY_ZIP["90002"].districts, ...BY_ZIP["10001"].districts],
      source: "congress.gov",
      congress: 119,
    });
  }

  if (path === "/api/users/me/jurisdiction") {
    if (req.method === "PUT") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      savedDistrict = JSON.parse(raw || "{}").districtId ?? null;
      return json({ districtId: savedDistrict });
    }
    if (req.method === "DELETE") {
      savedDistrict = null;
      return json({ districtId: null, district: null });
    }
    const all = [...BY_ZIP["90002"].districts, ...BY_ZIP["10001"].districts];
    return json({
      districtId: savedDistrict,
      district: all.find((d) => d.districtId === savedDistrict) ?? null,
    });
  }

  if (path === "/api/auth-challenge") return json({ configured: false });
  if (path.startsWith("/api/auth/sign-up")) {
    signedIn = true;
    return json({ user: USER, token: "t" });
  }
  if (path === "/api/verification/email") {
    return json({ email: USER.email, verified: false, deliverable: true });
  }
  if (path.startsWith("/api/verification/email/send")) return json({ sent: true });
  if (path === "/api/me") return signedIn ? json({ user: USER }) : json({ user: null }, 401);
  if (path.startsWith("/api/auth/get-session")) {
    return signedIn ? json({ user: USER, session: { id: "s1" } }) : json(null);
  }
  if (path.startsWith("/api/users/me")) return json(USER);
  if (path.startsWith("/api/")) {
    return json({
      results: [], posts: [], bills: [], data: [], items: [], comments: [], votes: [],
      notifications: [], references: [], conversations: [], delegations: [],
      count: 0, hasMore: false, nextCursor: null,
    });
  }

  let file = join(DIST, path === "/" ? "index.html" : path);
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
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

/** Open Edit profile, where the picker lives, and hand back the page. */
async function openPicker() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await acceptTermsBeforeLoad(context);
  const page = await context.newPage();
  await routeApiToLocal(page, base);
  await page.goto(`${base}/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(1_200);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) {
    await gotIt.first().click();
    await page.waitForTimeout(400);
  }
  await page.getByLabel("Edit profile").click();
  await page.waitForSelector('[data-testid="district-zip"]', { timeout: 15_000 });
  return { context, page };
}

async function lookUp(page, zip) {
  await page.locator('[data-testid="district-zip"]').fill(zip);
  await page.locator('[data-testid="district-zip-find"]').click();
  await page.waitForTimeout(900);
}

// ---------------------------------------------------------------------------
// 1. One ZIP, one district, and choosing it saves the district
// ---------------------------------------------------------------------------

{
  lookupBroken = false;
  savedDistrict = null;
  const { context, page } = await openPicker();

  check(
    "the ZIP box is the first thing offered",
    (await page.getByText("Find it with your ZIP code", { exact: false }).count()) > 0,
  );
  check(
    "and it promises the ZIP is not kept",
    (await page.getByText("discarded", { exact: false }).count()) > 0,
  );

  await lookUp(page, "10001");
  const results = page.locator('[data-testid="district-zip-results"]');
  check("a ZIP finds a district", (await results.count()) > 0);
  check(
    "the representative's name is shown, so somebody can recognise it",
    (await results.getByText("Jerrold Nadler", { exact: false }).count()) > 0,
  );
  check(
    "the boundaries say how old they are",
    (await results.getByText(VINTAGE, { exact: false }).count()) > 0,
  );
  check(
    "a single-district ZIP does not claim to cross any",
    (await results.getByText("That ZIP is in this district", { exact: false }).count()) > 0,
  );

  await results.getByRole("button", { name: /NY-12/ }).click();
  await page.waitForTimeout(900);
  check("choosing it saves the DISTRICT", savedDistrict === "NY-12", `saved=${savedDistrict}`);

  await context.close();
}

// ---------------------------------------------------------------------------
// 2. A ZIP across four districts offers four and picks none
// ---------------------------------------------------------------------------

{
  lookupBroken = false;
  savedDistrict = null;
  const { context, page } = await openPicker();
  await lookUp(page, "90002");

  const results = page.locator('[data-testid="district-zip-results"]');
  const options = results.locator("li button");
  check("all four districts are offered", (await options.count()) === 4, `${await options.count()}`);
  check(
    "and the screen says the ZIP crosses them",
    (await results.getByText("crosses 4 districts", { exact: false }).count()) > 0,
  );
  check("NOTHING IS CHOSEN FOR THEM", savedDistrict === null, `saved=${savedDistrict}`);

  // THE WAY OUT for the one in six a ZIP cannot settle. It asks them for an
  // address; this platform never does.
  const finder = results.locator('[data-testid="house-finder-link"]');
  check("a link to the House's own finder is offered", (await finder.count()) > 0);
  check(
    "and it points at house.gov, not at us",
    (await finder.first().getAttribute("href")) ===
      "https://www.house.gov/representatives/find-your-representative",
  );

  await context.close();
}

// ---------------------------------------------------------------------------
// 3. A ZIP in no district, and a lookup that cannot run, are different sentences
// ---------------------------------------------------------------------------

{
  lookupBroken = false;
  savedDistrict = null;
  const { context, page } = await openPicker();
  await lookUp(page, "00000");
  check(
    "a ZIP in no district says to check the digits",
    (await page.getByText("No district matched that ZIP", { exact: false }).count()) > 0,
  );
  await context.close();
}

{
  lookupBroken = true;
  savedDistrict = null;
  const { context, page } = await openPicker();
  await lookUp(page, "10001");

  const error = page.locator('[data-testid="district-zip-error"]');
  check("a broken lookup says it is broken", (await error.count()) > 0);
  check(
    "IT DOES NOT SAY THE ZIP IS IN NO DISTRICT",
    (await page.getByText("No district matched that ZIP", { exact: false }).count()) === 0,
  );
  check(
    "and it offers the House's finder instead of a dead end",
    (await error.locator('[data-testid="house-finder-link"]').count()) > 0,
  );
  check(
    "the search-by-state box is still there as the other way through",
    (await page.getByLabel("Search for your district").count()) > 0,
  );

  await context.close();
}

// ---------------------------------------------------------------------------
// 4. Sign-up offers it, and skipping it still finishes
// ---------------------------------------------------------------------------
//
// A district set later is a district almost nobody sets — the profile editor is
// not somewhere people go on their first day. So it is asked once, at the end
// of sign-up, and Skip is a real button: Amendment I holds that the vote
// originates in the individual, and a ballot conditional on saying where you
// live is exactly the lock-in that forbids.

{
  lookupBroken = false;
  savedDistrict = null;
  signedIn = false;

  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await acceptTermsBeforeLoad(context);
  const page = await context.newPage();
  await routeApiToLocal(page, base);
  await page.goto(`${base}/auth`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#root", { timeout: 25_000 });
  await page.waitForTimeout(1_200);
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) {
    await gotIt.first().click();
    await page.waitForTimeout(400);
  }

  await page.getByRole("button", { name: "Sign Up" }).first().click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder("Jane Citizen").fill("New Citizen");
  await page.getByPlaceholder("janecitizen").fill("newcitizen");
  await page.getByPlaceholder("you@example.com").fill("new@example.com");
  await page.locator('input[type="password"]').first().fill("a-throwaway-password");
  await page.getByPlaceholder("Re-enter password").fill("a-throwaway-password");
  await page.getByRole("button", { name: /Create Account/ }).click();
  await page.waitForTimeout(2_500);

  // Step two is the emailed code. Walking past it must still lead to step three.
  const lookAround = page.getByRole("button", { name: "Look around first" });
  check("sign-up reaches the verification step", (await lookAround.count()) > 0);
  await lookAround.first().click();
  await page.waitForTimeout(900);

  const step = page.locator('[data-testid="signup-district-step"]');
  check("and then OFFERS THE DISTRICT STEP", (await step.count()) > 0);
  check(
    "with the ZIP box, not a demand for an address",
    (await step.locator('[data-testid="district-zip"]').count()) > 0,
  );
  check(
    "it says the vote counts either way",
    (await step.getByText("counts either way", { exact: false }).count()) > 0,
  );

  // THE ZIP WORKS HERE TOO, not only in the profile editor.
  await step.locator('[data-testid="district-zip"]').fill("10001");
  await step.locator('[data-testid="district-zip-find"]').click();
  await page.waitForTimeout(900);
  check(
    "looking one up here finds a district",
    (await step.locator('[data-testid="district-zip-results"]').count()) > 0,
  );

  // SKIP IS A REAL BUTTON, given the same weight as Done.
  const skip = step.locator('[data-testid="skip-district"]');
  check("Skip for now is offered", (await skip.count()) > 0);
  await skip.click();
  await page.waitForTimeout(1_200);

  check("skipping it finishes sign-up", (await page.locator('[data-testid="signup-district-step"]').count()) === 0);
  check("AND SAVES NO DISTRICT", savedDistrict === null, `saved=${savedDistrict}`);

  await context.close();
}

await browser.close();
server.close();

console.log(failures.length ? `\n${failures.length} FAILED` : "\nall good");
process.exit(failures.length ? 1 : 0);
