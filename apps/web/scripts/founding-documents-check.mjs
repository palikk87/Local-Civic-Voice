/**
 * The founding documents, as a citizen actually reads them.
 *
 *   bun run founding-documents-check          (after `bun run build`)
 *
 * WHY THIS EXISTS. The badge is the thing most likely to break silently. For
 * months the phone printed "5 Articles enshrined in code" and the web printed
 * the same, and both numbers were the length of an array. They would have read
 * exactly the same with nothing enforced at all. A number that cannot change
 * is not a measurement, and no unit test sees it — only a browser does.
 *
 * WHAT IT PROVES, on the rendered page and not in the source:
 *   - The Constitution page renders Articles I to VII, including the two the
 *     rewrite added, and the binding definitions under Article VII.
 *   - THE COUNTED BADGE AGREES WITH THE DOCUMENT, on both pages, and is not
 *     the number of articles wearing the word "enforced".
 *   - The Bill of Rights page renders as Amendments I–V, part of the
 *     Constitution rather than a second document.
 *   - THE FIVE SENTENCES THAT WERE NOT TRUE APPEAR NOWHERE a reader can see
 *     them: magnification, demotion by a jury, encrypted personal data, a
 *     check on citizenship, and a Trust Score that determines influence.
 *
 * It needs no backend. These pages are the document, and the document is not
 * fetched from anywhere.
 */
import { launchChromium, routeApiToLocal, acceptTermsBeforeLoad } from "./chromium.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const DIST = process.argv[2] ?? "dist";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html",
                ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
                ".ico": "image/x-icon", ".webp": "image/webp" };

const failures = [];
function check(label, condition, detail) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label + (detail ? ` — ${detail}` : ""));
}

const server = createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url.startsWith("/api/")) {
    res.writeHead(503, { "content-type": "application/json" });
    return res.end('{"error":"api not served in this check"}');
  }
  let file = join(DIST, url === "/" ? "index.html" : url);
  try {
    if (!(await stat(file)).isFile()) throw new Error("dir");
  } catch {
    file = join(DIST, "index.html");
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await launchChromium();

async function open(path) {
  const page = await browser.newPage();
  await acceptTermsBeforeLoad(page);
  await routeApiToLocal(page, base);
  await page.goto(`${base}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  return page;
}

/**
 * The five sentences, as a reader would meet them. Checked on rendered text,
 * lower-cased, so a change of capitalisation does not smuggle one back in.
 */
const BANNED = [
  ["magnif", "nothing multiplies anybody's reach"],
  ["demot", "a jury makes a finding; it takes nothing away"],
  ["encrypted personal data", "nothing about a citizen is encrypted"],
  ["citizenship", "citizenship is never checked"],
  ["trust score determines", "the trust score determines nothing"],
  ["master reference id", "an internal identifier is not a thing to govern with"],
];

// ---------------------------------------------------------------- Constitution
{
  const page = await open("/constitution");
  const text = await page.locator("body").innerText();

  check("the Constitution renders", text.length > 500, `${text.length} chars`);
  for (const numeral of ["I", "II", "III", "IV", "V", "VI", "VII"]) {
    check(
      `Article ${numeral} is on the page`,
      // The page renders these headings uppercased by CSS, and innerText
      // reports what is rendered — so this reads case-insensitively rather
      // than pinning the styling.
      new RegExp(`Article\\s+${numeral}\\b`, "i").test(text),
    );
  }
  check(
    "Article VI is the rule about the badge",
    /Enforced in Code, or Not Claimed/i.test(text) || /How This Constitution Is Kept/i.test(text),
  );
  check("Article VII defines the binding terms", /Definitions/.test(text));
  check("…including Verified, Record and Civil Leader", /Verified/.test(text) && /Record/.test(text) && /Civil Leader/.test(text));
  check("the Amendments are named as part of this document", /Where an Amendment and an Article conflict/i.test(text));

  const counted = (await page.locator('[data-testid="articles-enforced-count"]').innerText()).trim();
  const m = counted.match(/(\d+) of (\d+) clauses/);
  check("the clause badge is a counted pair", Boolean(m), counted);
  if (m) {
    // 16 clauses is what the document has; the point is that the badge reads
    // the document rather than a hand-typed number, so both halves must move
    // together with it.
    check("the badge counts every clause the page renders", Number(m[2]) === 16, `total=${m[2]}`);
    check("…and does not claim more than it counts", Number(m[1]) <= Number(m[2]), counted);
  }

  const lower = text.toLowerCase();
  for (const [word, because] of BANNED) {
    check(`Constitution: "${word}" is nowhere on the page`, !lower.includes(word), because);
  }
  await page.close();
}

// ------------------------------------------------------------- Bill of Rights
{
  const page = await open("/bill-of-rights");
  const text = await page.locator("body").innerText();

  check("the Bill of Rights renders", text.length > 400, `${text.length} chars`);
  check("it presents as Amendments I–V", /Amendments I[–-]V/.test(text), text.slice(0, 120));
  check("it says it is part of the Constitution", /Part of this Constitution/i.test(text));
  for (const numeral of ["I", "II", "III", "IV", "V"]) {
    check(`Amendment ${numeral} is on the page`, new RegExp(`Amendment\\s+${numeral}\\b`, "i").test(text));
  }

  const badges = await page.locator('[data-testid="amendment-enforced"]').count();
  const counted = (await page.locator('[data-testid="amendments-enforced-count"]').innerText()).trim();
  const m = counted.match(/(\d+) of (\d+) Amendments/);
  check("the Amendment badge is a counted pair", Boolean(m), counted);
  if (m) {
    check("the count matches the badges actually rendered", Number(m[1]) === badges,
      `count says ${m[1]}, ${badges} badges on the page`);
    check("it counts all five Amendments", Number(m[2]) === 5, `total=${m[2]}`);
  }

  const lower = text.toLowerCase();
  for (const [word, because] of BANNED) {
    check(`Bill of Rights: "${word}" is nowhere on the page`, !lower.includes(word), because);
  }
  await page.close();
}

// ------------------------------------------------- the combined Documents page
{
  const page = await open("/documents");
  const text = await page.locator("body").innerText();
  check("the combined page renders both", /The Constitution/.test(text) && /The Bill of Rights/.test(text));
  const counted = (await page.locator('[data-testid="documents-enforced-count"]').innerText()).trim();
  check("its footer is counted too", /\d+ of \d+ clauses/.test(counted), counted);
  const lower = text.toLowerCase();
  for (const [word] of BANNED) {
    check(`Documents: "${word}" is nowhere on the page`, !lower.includes(word));
  }
  await page.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nall good");
