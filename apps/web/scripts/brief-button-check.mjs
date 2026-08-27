/**
 * Proves the Citizen's Brief asks before it works, and always stops.
 *
 *   bun run brief-button-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The brief got stuck in a load loop: opening a law started
 * the work by itself, the page polled a server status while it said "writing",
 * and when the job behind that status died — a restart, a deploy — the status
 * stayed put and the spinner never stopped. Reloading did not help, because the
 * stuck state was in the database.
 *
 * Both halves of that are UI behaviour, and neither typecheck, lint, nor build
 * can see them. Only running the page can.
 *
 * Four cases:
 *
 *   1. Opening a law makes NO brief request. The button is offered instead.
 *   2. Pressing it makes exactly one request, and the brief renders.
 *   3. A law whose text is unpublished settles on an honest message and a way
 *      to try again — not a spinner.
 *   4. A record the server reports as stuck mid-write is shown the button, not
 *      a spinner. This is the load loop, and it must not be reachable.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";

const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const BRIEF = {
  summary:
    "This law puts money into upgrading the rail network and making level crossings safer, " +
    "and sets out how much is available each year through 2030.",
  argumentFor:
    "The text funds safety work at the crossings where the law itself says preventable deaths " +
    "happen, and replaces an authority that would otherwise expire.",
  argumentAgainst:
    "The text commits money for five years without tying it to any measured result, and leaves " +
    "the choice of which crossings get work unspecified.",
};

/**
 * Three records, one per state the reader can land in.
 *
 * `stuck` is the important one: the server reports briefState "idle" for a row
 * whose raw contentStatus still says it is writing, because the work behind
 * that claim aged out. The page must believe the collapsed state.
 */
const RECORDS = {
  plain: { briefState: "idle", contentStatus: null },
  unpublished: { briefState: "idle", contentStatus: null, noText: true },
  stuck: { briefState: "idle", contentStatus: "brief_pending" },
};

function reference(id, record) {
  return {
    id,
    masterReferenceId: "hr-4836-119",
    displayId: "H.R. 4836",
    referenceType: "bill",
    title: "A bill to improve the provision of health care and benefits",
    shortTitle: "Veterans Health Improvement Act",
    status: "committee",
    category: "healthcare",
    chamber: "house",
    congress: 119,
    sourceUrl: "https://www.congress.gov/",
    description: "Reported out of committee with amendments.",
    citizenBrief: null,
    citizenBriefSections: null,
    citizenBriefAt: null,
    citizenBriefVersion: null,
    lawVersion: 1,
    lawChangedAt: null,
    contentStatus: record.contentStatus,
    briefState: record.briefState,
    fullText: null,
    fullTextSource: null,
    fullTextUrl: null,
    fullTextAt: null,
    sourceCheckedAt: null,
    signedDate: null,
    decidedDate: null,
    aliases: [],
    votes: { support: 0, oppose: 0, total: 0 },
    engagement: { comments: 0, shares: 0, posts: 0 },
    userVote: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Every POST the page made to the brief endpoint, in order. */
const briefRequests = [];

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];

  const brief = /^\/api\/government-references\/([^/]+)\/brief$/.exec(url);
  if (brief) {
    const id = brief[1];
    briefRequests.push(id);
    res.writeHead(200, { "content-type": "application/json" });
    if (RECORDS[id]?.noText) {
      return res.end(
        JSON.stringify({
          state: "unavailable",
          reason:
            "The full text of this law isn't published anywhere we can read yet. A brief is " +
            "written only from the law itself, so rather than guess at what it says, we're " +
            "not showing one.",
        }),
      );
    }
    return res.end(
      JSON.stringify({
        state: "ready",
        brief: BRIEF,
        lawVersion: 1,
        briefVersion: 1,
      }),
    );
  }

  const detail = /^\/api\/government-references\/([^/]+)$/.exec(url);
  if (detail) {
    const id = detail[1];
    const record = RECORDS[id];
    if (!record) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end('{"error":"Reference not found"}');
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ reference: reference(id, record) }));
  }

  if (url.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end("{}");
  }

  let file = join(DIST, url === "/" ? "index.html" : url);
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

/** Open a law and report what the brief card is showing. */
async function open(id) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await acceptTermsBeforeLoad(page);
  await routeApiToLocal(page, base);
  await page.goto(`${base}/reference/${id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Citizen's Brief", { timeout: 15_000 });
  return page;
}

async function read(page) {
  return page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((b) =>
      /Get the Citizen's Brief|Check the source again/i.test(b.textContent ?? ""),
    );
    const text = document.body.innerText;
    return {
      buttonLabel: button?.textContent?.trim() ?? null,
      spinning: !!document.querySelector(".animate-spin"),
      hasSummary: text.includes("upgrading the rail network"),
      hasCaseFor: text.includes("THE CASE FOR") || text.includes("The Case For"),
      hasCaseAgainst: text.includes("THE CASE AGAINST") || text.includes("The Case Against"),
      saysUnavailable: text.includes("isn't published anywhere"),
    };
  });
}

function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// 1. Opening a law asks for nothing. The old page started the work here.
{
  const page = await open("plain");
  const state = await read(page);
  check("opening a law makes no brief request", briefRequests.length === 0,
    `requests=${briefRequests.length}`);
  check("the button is offered", state.buttonLabel === "Get the Citizen's Brief",
    `button=${JSON.stringify(state.buttonLabel)}`);
  check("nothing is spinning", !state.spinning);

  // 2. Pressing it asks once and renders the result.
  await page.getByRole("button", { name: "Get the Citizen's Brief" }).click();
  await page.waitForSelector("text=upgrading the rail network", { timeout: 15_000 });
  const after = await read(page);
  check("pressing it makes exactly one request", briefRequests.length === 1,
    `requests=${briefRequests.length}`);
  // All three parts, because the product is the paragraph AND both sides. A
  // card that renders the summary alone is a different, worse thing.
  check("the neutral paragraph renders", after.hasSummary);
  check("the case for renders", after.hasCaseFor);
  check("the case against renders", after.hasCaseAgainst);
  check("the spinner is gone", !after.spinning);
  await page.close();
}

// 3. No official text settles on a message and a way to retry — never a spinner.
{
  briefRequests.length = 0;
  const page = await open("unpublished");
  await page.getByRole("button", { name: "Get the Citizen's Brief" }).click();
  await page.waitForSelector("text=isn't published anywhere", { timeout: 15_000 });
  const state = await read(page);
  check("unavailable says why", state.saysUnavailable);
  check("and offers a retry", state.buttonLabel === "Check the source again",
    `button=${JSON.stringify(state.buttonLabel)}`);
  check("and is not spinning", !state.spinning);
  await page.close();
}

// 4. THE LOAD LOOP. A row still claiming to be mid-write, reported by the
//    server as idle because that claim aged out. The page must offer the
//    button rather than poll forever.
{
  briefRequests.length = 0;
  const page = await open("stuck");
  const state = await read(page);
  check("a stalled record shows the button, not a spinner",
    state.buttonLabel === "Get the Citizen's Brief" && !state.spinning,
    `button=${JSON.stringify(state.buttonLabel)} spinning=${state.spinning}`);

  // And it stays that way — no background poll quietly restarting.
  await page.waitForTimeout(6000);
  const later = await read(page);
  check("and it stays that way with no polling",
    later.buttonLabel === "Get the Citizen's Brief" && briefRequests.length === 0,
    `requests=${briefRequests.length}`);
  await page.close();
}

await browser.close();
server.close();

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe brief is asked for, never automatic, and every state ends somewhere.");
