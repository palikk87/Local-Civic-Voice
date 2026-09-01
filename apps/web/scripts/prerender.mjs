/**
 * REAL HTML FOR THE PAGES WE ASK TO HAVE INDEXED.
 *
 *   node scripts/prerender.mjs dist        (runs automatically after a build)
 *
 * THE PROBLEM. This is a single-page app: the server sends one shell for every
 * path and JavaScript fills it in. Google will run that JavaScript, eventually
 * and unreliably; the bots that build a link preview — X, Facebook, iMessage,
 * Slack, WhatsApp — will not run it at all. So every law anybody has ever
 * shared showed the site's generic banner, and no record had a title of its
 * own in the HTML anybody actually received.
 *
 * WHAT THIS DOES. After the bundle is built, it asks the server which records
 * have earned a listing, and writes a copy of the shell for each one with that
 * record's title, description, canonical link, preview tags and JSON-LD baked
 * in. The app boots on top exactly as before and replaces nothing — a person
 * sees the same page; a crawler sees a page that says what it is.
 *
 * WHY STATIC FILES RATHER THAN A FUNCTION PER REQUEST. There are around 1,900
 * records and they barely change. Files on a CDN cost nothing to serve, have no
 * cold start, and — the deciding argument — keep the API off the crawl path
 * entirely. A function would mean Google's view of this site is down whenever
 * Railway is. A daily rebuild matches a daily ingest: the content is at most
 * twenty-four hours old either way.
 *
 * A BUILD MUST NOT FAIL BECAUSE THE API BLINKED — EXCEPT IN PRODUCTION.
 *
 * On a laptop or a preview build, an unreachable API is a warning and this
 * exits 0: blocking a deploy over a transient network error is worse than a
 * deploy without prerendered pages.
 *
 * In production it is the other way round, and the reason is what Vercel does
 * with a failed build: it keeps the previous deployment serving. So a red build
 * leaves yesterday's working pages up, while exiting 0 replaces every one of
 * them with the generic shell — green, silent, and only discoverable by
 * curling a record URL and reading the title. That is the failure this guard
 * exists for.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const DIST = resolve(process.argv[2] ?? "dist");
const API =
  process.env.PRERENDER_API_URL ??
  process.env.VITE_BACKEND_URL ??
  "https://api.ayeandnay.com";
const SITE = (process.env.PRERENDER_SITE_URL ?? "https://ayeandnay.com").replace(/\/+$/, "");

/** HTML-escape, for anything going into an attribute or a text node. */
const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const BRANCH_LABEL = {
  bill: "Bill",
  executive_order: "Executive order",
  scotus_case: "Supreme Court case",
};

/**
 * The title, written as the thing somebody would type into a search box.
 *
 * "EO 14421: Declaring a National Emergency…" and not "AYE & NAY — Civic
 * Platform". The brand goes last, where it costs nothing.
 */
function titleFor(record) {
  const label = BRANCH_LABEL[record.referenceType] ?? "Record";
  const id = record.slug?.startsWith("eo-")
    ? `Executive Order ${record.slug.replace("eo-", "")}`
    : label;
  return `${id}: ${record.title} — AYE & NAY`.slice(0, 180);
}

function descriptionFor(record) {
  const written = record.citizenBrief || record.description;
  if (written) return written.replace(/\s+/g, " ").trim().slice(0, 300);
  return `What ${record.title} does, who is behind it, and where the public stands on it.`.slice(0, 300);
}

/**
 * Structured data, from the record rather than about the site.
 *
 * Only fields we actually hold — a schema filled with plausible blanks is the
 * same lie as a page filled with them.
 */
function jsonLdFor(record, url) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Legislation",
    name: record.title,
    url,
    legislationIdentifier: record.slug ?? undefined,
    legislationType: BRANCH_LABEL[record.referenceType] ?? undefined,
    datePublished:
      record.signedDate ?? record.decidedDate ?? record.introducedDate ?? undefined,
    description: descriptionFor(record),
    isPartOf: { "@type": "WebSite", name: "AYE & NAY", url: SITE },
  };
  for (const key of Object.keys(data)) if (data[key] === undefined) delete data[key];
  return JSON.stringify(data);
}

/**
 * Put this record's identity into the shell.
 *
 * The shell's own tags are REPLACED rather than appended to — two og:title tags
 * is a coin toss over which one a preview uses, and the generic one winning is
 * the bug this exists to fix.
 */
function render(shell, record) {
  const url = `${SITE}${record.path}`;
  const title = titleFor(record);
  const description = descriptionFor(record);

  let html = shell;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(
    /<meta name="description"[^>]*>/,
    `<meta name="description" content="${esc(description)}" />`,
  );
  html = html.replace(
    /<meta property="og:title"[^>]*>/,
    `<meta property="og:title" content="${esc(title)}" />`,
  );
  html = html.replace(
    /<meta property="og:description"[^>]*>/,
    `<meta property="og:description" content="${esc(description)}" />`,
  );
  html = html.replace(
    /<meta property="og:type"[^>]*>/,
    `<meta property="og:type" content="article" />`,
  );

  const head =
    `<link rel="canonical" href="${esc(url)}" />` +
    `<meta property="og:url" content="${esc(url)}" />` +
    `<meta name="twitter:title" content="${esc(title)}" />` +
    `<meta name="twitter:description" content="${esc(description)}" />` +
    `<script type="application/ld+json">${jsonLdFor(record, url)}</script>`;
  html = html.replace("</head>", `${head}</head>`);

  /*
   * AND THE HEADLINE IN THE BODY, where a crawler that reads no JavaScript can
   * still see what the page is about. React replaces the whole of #root on
   * boot, so this is what is on the page for the fraction of a second before
   * that happens and forever for anything that never boots it.
   */
  const fallback =
    `<div id="prerendered-record">` +
    `<h1>${esc(record.title)}</h1>` +
    `<p>${esc(description)}</p>` +
    `</div>`;
  html = html.replace('<div id="root"></div>', `<div id="root">${fallback}</div>`);

  return html;
}

async function main() {
  const shellPath = join(DIST, "index.html");
  let shell;
  try {
    shell = await readFile(shellPath, "utf8");
  } catch {
    console.error(`prerender: no ${shellPath} — run the build first.`);
    process.exit(1);
  }

  // Set by Vercel on the build that becomes the live site. Absent locally and
  // on preview deploys, which is exactly the split this guard wants.
  const isProduction = process.env.VERCEL_ENV === "production";

  let records = [];
  try {
    const response = await fetch(`${API}/api/sitemap/records`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`the server answered ${response.status}`);
    ({ records } = await response.json());
  } catch (error) {
    const detail = `could not reach ${API} (${error?.message ?? error})`;
    if (isProduction) {
      console.error(
        `prerender: ${detail}.\n` +
          `Refusing to publish a site with no record pages. Vercel keeps the ` +
          `current deployment serving, so the pages that are live stay live. ` +
          `Check the API, then redeploy.`,
      );
      process.exit(1);
    }
    console.warn(`prerender: ${detail}. Building the shell only.`);
    return;
  }

  if (records.length === 0) {
    // WHAT ZERO MEANS DEPENDS ON WHERE YOU ARE. On an empty local database it
    // means nothing has earned a listing yet. In production it cannot mean
    // that: findable.ts submits any record with a brief, a real description or
    // three votes, and hundreds qualify. Zero there means something is broken
    // upstream, and shipping it would delete every page we have.
    if (isProduction) {
      console.error(
        `prerender: ${API} returned no records at all.\n` +
          `Hundreds qualify in production, so this is a fault rather than an ` +
          `empty shelf. Refusing to replace every record page with the shell.`,
      );
      process.exit(1);
    }
    console.log(
      "prerender: no record has earned a listing yet — nothing to write. " +
        "See the backend's services/findable.ts for what earns one.",
    );
    return;
  }

  for (const record of records) {
    const dir = join(DIST, record.path);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), render(shell, record), "utf8");
  }

  console.log(`prerender: wrote ${records.length} record page(s) with their own titles.`);
}

await main();
