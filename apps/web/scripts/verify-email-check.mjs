/**
 * There is somewhere to type the code, and the page tells the truth about it.
 *
 *   bun run verify-email-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Verification shipped with the code box living inside the
 * sign-up form and nowhere else. Close that form — a reload, a closed tab, or
 * pressing "Look around first" — and it was gone for good. What remained was a
 * banner that said "enter the code we emailed you" above a single button
 * labelled *Send another*. The app instructed people to do a thing it gave them
 * no way to do, and mailed them a fresh code every time they went looking.
 *
 * Underneath it was worse: the send went through Better Auth, whose endpoint
 * hands the message to a background runner that catches every error and answers
 * `{ success: true }` regardless. On a deployment with no mail provider the
 * screen said "Sent." over an inbox that would never receive anything.
 *
 * Four things are pinned here:
 *
 *   1. The banner exists for an unverified account, and it OPENS A CODE BOX.
 *   2. A wrong code is refused, in words, without closing anything.
 *   3. The right code verifies and the banner goes away.
 *   4. A server that cannot send email says so on the screen, and "send
 *      another code" reports the refusal instead of claiming success.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const RIGHT_CODE = "246813";
const USER = {
  id: "u1",
  name: "Test Reader",
  email: "reader@example.com",
  username: "reader",
  emailVerified: false,
};

/** Flipped by the scenario under test. */
let deliverable = true;
/** Every send the page asked for, so "it claimed success" is measurable. */
const sends = [];

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/api/verification/email") {
    return json({ email: USER.email, verified: USER.emailVerified, deliverable });
  }

  if (path === "/api/verification/email/send" && req.method === "POST") {
    sends.push(Date.now());
    if (!deliverable) {
      return json(
        {
          sent: false,
          code: "email_not_configured",
          error: "This server cannot send email yet, so no code can reach you.",
        },
        503,
      );
    }
    return json({ sent: true, verified: false, email: USER.email });
  }

  if (path === "/api/auth/email-otp/verify-email" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { otp } = JSON.parse(raw || "{}");
    if (otp !== RIGHT_CODE) {
      return json({ message: "That code did not work. Check it and try again." }, 400);
    }
    USER.emailVerified = true;
    return json({ status: true, token: null, user: USER });
  }

  if (path === "/api/me") return json({ user: USER });
  if (path.startsWith("/api/auth/get-session")) {
    return json({ user: USER, session: { id: "s1" } });
  }
  if (path.startsWith("/api/")) return json({ results: [], bills: [], posts: [] });

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

const codeBox = (page) => page.getByPlaceholder("6-digit code");

/**
 * Close the first-run welcome dialog.
 *
 * It is a Radix dialog, which marks the rest of the page aria-hidden while it
 * is open — so every role-based query below finds nothing until it is gone.
 * That is the dialog working correctly, and a check that did not dismiss it
 * would be measuring the overlay rather than the banner.
 */
async function dismissWelcome(page) {
  const gotIt = page.getByRole("button", { name: "Got it" });
  if ((await gotIt.count()) > 0) {
    await gotIt.first().click();
    await page.waitForTimeout(400);
  }
}

// ---------------------------------------------------------------------------
// 1. A server that can send: banner -> code box -> wrong code -> right code
// ---------------------------------------------------------------------------

{
  deliverable = true;
  USER.emailVerified = false;

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await acceptTermsBeforeLoad(page);
  await routeApiToLocal(page, base);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await dismissWelcome(page);

  const banner = page.getByText("Enter the code we emailed you", { exact: false });
  check("an unverified account is told it cannot take part yet", (await banner.count()) > 0);

  // The bug, exactly: before this the banner's only control was "Send another".
  check("there is nowhere to type a code until it is asked for", (await codeBox(page).count()) === 0);

  const open = page.getByRole("button", { name: "Enter code" });
  check("the banner offers a way in", (await open.count()) > 0);
  await open.first().click();
  await page.waitForTimeout(500);

  check("pressing it opens a code box", (await codeBox(page).count()) > 0);

  await codeBox(page).first().fill("000000");
  await page.getByRole("button", { name: "Verify" }).first().click();
  await page.waitForTimeout(700);

  check(
    "a wrong code is refused in words",
    (await page.getByText("That code did not work", { exact: false }).count()) > 0,
  );
  check("and the code box stays open", (await codeBox(page).count()) > 0);

  await codeBox(page).first().fill(RIGHT_CODE);
  await page.getByRole("button", { name: "Verify" }).first().click();
  await page.waitForTimeout(1500);

  check("the right code closes the box", (await codeBox(page).count()) === 0);
  check(
    "and the banner is gone",
    (await page.getByText("Enter the code we emailed you", { exact: false }).count()) === 0,
  );

  await page.close();
}

// ---------------------------------------------------------------------------
// 2. A server that cannot send email does not pretend otherwise
// ---------------------------------------------------------------------------

{
  deliverable = false;
  USER.emailVerified = false;
  sends.length = 0;

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await acceptTermsBeforeLoad(page);
  await routeApiToLocal(page, base);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await dismissWelcome(page);

  await page.getByRole("button", { name: "Enter code" }).first().click();
  await page.waitForTimeout(700);

  check(
    "the screen says no code is coming",
    (await page.getByText("cannot send email right now", { exact: false }).count()) > 0,
  );

  await page.getByRole("button", { name: "Send another code" }).first().click();
  await page.waitForTimeout(700);

  check("asking anyway reaches the server", sends.length === 1, `sends=${sends.length}`);
  check(
    "and the refusal is shown, not swallowed",
    (await page.getByText("cannot send email yet", { exact: false }).count()) > 0,
  );
  check(
    "nothing claims the message was sent",
    (await page.getByText("Sent. It can take a minute", { exact: false }).count()) === 0,
  );

  await page.close();
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} verification check(s) failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nThere is somewhere to type the code, and the page never claims a send that did not happen.");
