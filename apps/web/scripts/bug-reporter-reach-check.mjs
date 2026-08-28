/**
 * The bug reporter works while a dialog is open — which is when it is needed.
 *
 *   bun run bug-reporter-reach-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. Reported as "the bug reporter doesnt work with these
 * screens", and the two reports before it were the evidence: both were about
 * dialogs, and both could only point at the BUTTON that opened the dialog
 * rather than at anything inside it.
 *
 * Measured in a browser with a dialog open, before the fix: a modal dialog sets
 * `pointer-events: none` on the body, so the launcher inherited it; it sat at
 * z-50, the same as the overlay now painted over it; `elementFromPoint` over
 * the launcher returned the overlay; the click timed out; and the launcher was
 * inside an aria-hidden subtree.
 *
 * THE PART THAT IS EASY TO GET WRONG. Making the button reachable is half the
 * job. A modal dialog dismisses on any pointer-down outside itself, so a
 * reachable button would close the very dialog somebody opened the reporter to
 * complain about — the same bug wearing a hat. That is what the last two
 * checks here are for.
 *
 * The one part of the app whose whole job is reporting the others cannot be the
 * part that stops working when something is wrong.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

/** The display it was reported on. */
const VIEWPORT = { width: 1476, height: 661 };

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const SIGNED_IN = {
  user: { id: "u1", name: "Test Reader", email: "reader@example.com", username: "reader" },
  session: { id: "s1" },
};

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** What the reporter actually posted, so nothing has to be inferred. */
let filed = null;

const server = createServer(async (req, res) => {
  const [path] = req.url.split("?");
  const json = (body, code = 200) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (path === "/api/bug-reports" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    filed = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    return json({ id: "br1" }, 201);
  }
  if (path.startsWith("/api/auth/get-session")) return json(SIGNED_IN);
  if (path === "/api/me") return json(SIGNED_IN);
  if (path.startsWith("/api/users/")) {
    return json({
      id: "them", username: "someone", displayName: "Someone Else", avatar: "", bio: "",
      location: "", joinedDate: new Date().toISOString(), followers: 0, following: 0,
      votesCount: 0, isFollowing: false,
    });
  }
  if (path.startsWith("/api/")) {
    return json({
      results: [], posts: [], data: [], items: [], comments: [], votes: [], notifications: [],
      references: [], conversations: [], delegations: [], requirements: [],
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

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await launchChromium();

const context = await browser.newContext({ viewport: VIEWPORT });
await acceptTermsBeforeLoad(context);
const page = await context.newPage();
await routeApiToLocal(page, base);
await page.goto(`${base}/user/them`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#root", { timeout: 25_000 });
await page.waitForTimeout(1_500);

try {
  // Open the thing somebody would want to complain about.
  await page.locator('[data-testid="report-user"]').click();
  await page.waitForSelector('[data-testid="report-dialog"]', { timeout: 10_000 });
  await page.waitForTimeout(600);

  // ------------------------------------------------ is it reachable at all
  const state = await page.evaluate(() => {
    const launcher = document.querySelector("[data-bug-reporter]");
    if (!launcher) return null;
    const box = launcher.getBoundingClientRect();
    const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      pointerEvents: getComputedStyle(launcher).pointerEvents,
      onTop: !!at?.closest("[data-bug-reporter]"),
      hidden: !!launcher.closest("[aria-hidden='true']"),
    };
  });

  check("the launcher exists with a dialog open", state !== null);
  check("…it takes pointer events, on a body a dialog set to none", state?.pointerEvents === "auto", state?.pointerEvents);
  check("…IT IS ON TOP OF THE DIALOG'S OVERLAY, not under it", state?.onTop === true);
  check("…and it is not hidden from a screen reader", state?.hidden === false);

  // --------------------------------------- clicking it must not close the dialog
  await page.locator("[data-bug-reporter]").click({ timeout: 5_000 });
  await page.waitForTimeout(500);
  check(
    "CLICKING IT DOES NOT DISMISS THE DIALOG being reported",
    (await page.locator('[data-testid="report-dialog"]').count()) === 1,
  );
  check("…and the reporter opened", (await page.locator("#bug-problem").count()) === 1);

  // ------------------------------- and it can point at something INSIDE the dialog
  await page.getByRole("button", { name: /Point at the problem/i }).click();
  await page.waitForTimeout(400);

  // Point at a reason inside the dialog. Deliberately an ENABLED element: the
  // first version of this pointed at the send button, which is disabled until a
  // reason is chosen, and a disabled button carries `pointer-events: none`, so
  // the hit test correctly returned its parent instead. That was the check
  // being wrong, not the picker — but an enabled target tests the thing
  // somebody would actually point at.
  const inside = await page.locator('label[for="reason-harassment"]').boundingBox();
  check("something inside the dialog is on screen to be pointed at", !!inside);
  if (inside) {
    await page.mouse.click(inside.x + inside.width / 2, inside.y + inside.height / 2);
    await page.waitForTimeout(500);
  }
  check(
    "…and the dialog is STILL open after pointing at it",
    (await page.locator('[data-testid="report-dialog"]').count()) === 1,
  );

  await page.locator("#bug-problem").fill("The dialog runs off the bottom of my screen.");
  await page.getByRole("button", { name: /Send to the team/i }).click();
  await page.waitForTimeout(1_500);

  check("the report was sent", filed !== null);
  check(
    "IT NAMES SOMETHING INSIDE THE DIALOG, not the button that opened it",
    /Harassment/i.test(String(filed?.elementDetail?.html ?? "")) ||
      /Harassment/i.test(String(filed?.elementLabel ?? "")),
    `${filed?.elementLabel ?? "(no label)"} · ${String(filed?.elementDetail?.html ?? "").slice(0, 70)}`,
  );

  // The whole point of the two earlier reports: they could only name the button
  // that OPENED the dialog, because that was all that was reachable.
  check(
    "…and not the Report button that opened it",
    !/data-testid="report-user"/.test(String(filed?.elementDetail?.html ?? "")),
    filed?.elementPath ?? "",
  );
  check(
    "…and not the overlay sitting on top of everything",
    !/bg-black\/80|z-50 bg-black/.test(String(filed?.elementDetail?.html ?? "")),
    String(filed?.elementDetail?.html ?? "").slice(0, 80),
  );
} catch (error) {
  check("the check ran", false, error.message.split("\n")[0]);
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nThe bug reporter reaches over an open dialog, points inside it, and leaves it open.");
