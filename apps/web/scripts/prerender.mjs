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
 * AND ITS OWN PICTURE. Alongside each page it draws that record's law card as a
 * 1200×630 PNG and points og:image at it, so a link pasted into a text message
 * or onto Facebook shows THAT law — its branch, its number, its title and where
 * the Public Pulse stands — instead of the one house banner every record used
 * to share. See scripts/og-card.mjs.
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

/** Where this record's share picture lives, relative to the site root. */
function imagePathFor(record) {
  return `/og/${record.slug}.png`;
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
function render(shell, record, hasCard) {
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

  /*
   * NO CARD, NO CLAIM. Pointing og:image at a file this build did not write
   * would give every preview a broken image — strictly worse than the banner it
   * would have shown.
   */
  if (hasCard) {
  /*
   * THE SHELL'S IMAGE TAGS ARE REPLACED, NOT ADDED TO. Two og:image tags is a
   * coin toss over which one a preview uses, and the generic one winning is the
   * bug this exists to fix — the same trap the title and description tags above
   * are written to avoid.
   */
  const image = `${SITE}${imagePathFor(record)}`;
  // From the record's own title, not the page title — that one already ends
  // "— AYE & NAY", and appending the brand again read as a stutter.
  const imageAlt = `${record.title} — where the Public Pulse stands, on AYE & NAY`;
  html = html.replace(
    /<meta property="og:image"[^>]*>/,
    `<meta property="og:image" content="${esc(image)}" />`,
  );
  html = html.replace(
    /<meta property="og:image:alt"[^>]*>/,
    `<meta property="og:image:alt" content="${esc(imageAlt)}" />`,
  );
  html = html.replace(
    /<meta name="twitter:image"[^>]*>/,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  );
  html = html.replace(
    /<meta name="twitter:image:alt"[^>]*>/,
    `<meta name="twitter:image:alt" content="${esc(imageAlt)}" />`,
  );
  }

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

/**
 * THE PORTRAIT, FETCHED ONCE PER PERSON — AND NOT GIVEN UP ON TOO EASILY.
 *
 * Two hundred bills can share one sponsor, so this is keyed by the image and
 * every record after the first is free.
 *
 * WHY IT RETRIES. The first version cached failures as permanently as
 * successes, which is wrong for the failure that actually happens: an image
 * host answering 429 because we asked for two hundred faces in a hurry. One
 * throttled response would have poisoned that person for the whole build and
 * shipped their cards faceless, quietly. Measured against the live set, six of
 * the nine "missing" portraits were exactly this — they downloaded fine when
 * asked one at a time. So a 404 is believed and cached; a 429 or a 5xx is
 * waited out and asked again.
 *
 * WHY bioguide COMES FIRST. congress.gov serves member portraits from a stable
 * path built out of the bioguide id and does not throttle us; the Wikipedia
 * copy is the one that does. When a record carries both, take the one that
 * answers reliably.
 */
const portraits = new Map();
/** Records that should carry a face, and whether they got one. */
const faceLedger = { expected: 0, drawn: 0, missing: [] };

/*
 * THE SERVER DECIDES WHERE A FACE COMES FROM, NOT THIS SCRIPT.
 *
 * This used to build a congress.gov URL itself, which is how it inherited that
 * source's two failures: four sitting members with no photograph there, and one
 * whose "photo" is 64KB of bytes that are not a picture. The API now serves
 * every portrait from /api/portraits — official source first, then two mirrors,
 * bytes checked, kept once — so `photoUrl` is the answer and there is nothing
 * left here to get wrong.
 */
function portraitSources(who) {
  return who?.photoUrl ? [who.photoUrl] : [];
}

/** What these bytes actually are, by their own signature, or null. */
function imageKind(bytes) {
  if (bytes.length < 1000) return null;
  const head = bytes.subarray(0, 12);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  return null;
}

async function download(url) {
  // Three goes, backing off. Anything that is not a 404 gets another chance.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.status === 404) return null;
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        const kind = imageKind(bytes);
        // THE HEADER IS NOT EVIDENCE. congress.gov serves exactly 65,536 bytes
        // of something beginning "\x00nod" for at least one member, labelled
        // image/jpeg, every time it is asked. It passed a size check and a
        // content-type check, and then the rasteriser died on it and took that
        // record's whole card with it. So the bytes are asked what they are.
        return kind ? `data:${kind};base64,${bytes.toString("base64")}` : null;
      }
    } catch {
      // Timed out or the connection went; the wait below covers it.
    }
    await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
  }
  return null;
}

async function portraitFor(record) {
  const who = record.attribution;
  const sources = portraitSources(who);
  if (!sources.length) return null;

  faceLedger.expected += 1;
  const key = sources[0];
  if (portraits.has(key)) {
    const cached = portraits.get(key);
    if (cached) faceLedger.drawn += 1;
    else faceLedger.missing.push(`${record.slug} (${who.name})`);
    return cached;
  }

  let data = null;
  for (const source of sources) {
    data = await download(source);
    if (data) break;
  }
  portraits.set(key, data);
  if (data) faceLedger.drawn += 1;
  else faceLedger.missing.push(`${record.slug} (${who.name})`);
  return data;
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

  await mkdir(join(DIST, "og"), { recursive: true });

  /*
   * THE CARD DRAWER IS LOADED HERE, NOT AT THE TOP, AND IS ALLOWED TO BE
   * ABSENT.
   *
   * It rests on @resvg/resvg-js, which is a native module: it ships a prebuilt
   * binary per platform, and a build machine it has no binary for fails at
   * IMPORT — before any of this runs. A static import would therefore turn "the
   * pictures could not be drawn" into "the site did not deploy", which is a
   * worse trade than it sounds: the pages are the deliverable and the share
   * preview falls back to the site's banner, which is exactly what shipped
   * before this existed.
   *
   * Loudness is reserved for the thing that matters. An unreachable API means
   * no record pages at all and stops a production build; a missing rasteriser
   * costs the pictures and says so.
   */
  let renderCard = null;
  try {
    ({ renderCard } = await import("./og-card.mjs"));
  } catch (error) {
    console.warn(
      `prerender: no share cards this build — ${error?.message ?? error}. ` +
        `Pages are unaffected; previews fall back to the site's banner.`,
    );
  }

  let drawn = 0;
  for (const record of records) {
    /*
     * A CARD THAT WILL NOT DRAW MUST NOT LOSE THE PAGE. The page is the
     * deliverable; the picture is what makes it look like something when it is
     * shared. If one record's card throws — an unexpected character, a title
     * that defeats the layout — that record keeps its page, its preview falls
     * back to the banner, and the build names it so it can be looked at.
     *
     * Drawn BEFORE the page is written, so the page only claims a picture that
     * exists.
     */
    let hasCard = false;
    if (renderCard) {
      const portrait = await portraitFor(record);
      try {
        let png;
        try {
          png = await renderCard({ ...record, portrait });
        } catch (error) {
          /*
           * A PORTRAIT THAT WILL NOT DRAW COSTS THE PORTRAIT, NOT THE CARD.
           *
           * An image can download intact and still defeat the rasteriser. When
           * that happened the whole card was lost and the record fell back to
           * the house banner — trading a face for everything else on it, which
           * is the wrong way round. Draw it again without the picture.
           */
          if (!portrait) throw error;
          console.warn(
            `prerender: ${record.slug} would not draw with its portrait ` +
              `(${error?.message ?? error}); drawing it without.`,
          );
          faceLedger.drawn -= 1;
          faceLedger.missing.push(`${record.slug} (portrait would not render)`);
          png = await renderCard({ ...record, portrait: null });
        }
        await writeFile(join(DIST, "og", `${record.slug}.png`), png);
        hasCard = true;
        drawn += 1;
      } catch (error) {
        console.warn(`prerender: could not draw the card for ${record.slug} (${error?.message ?? error})`);
      }
    }

    /*
     * EVERY ADDRESS THE RECORD ANSWERS TO GETS THE PAGE, not only the pretty
     * one.
     *
     * /reference/:id is what the app's own address bar shows and what every
     * link shared before the slugs existed still uses — a real one, pasted from
     * a browser an hour ago, reads
     * ayeandnay.com/reference/cmth6ynso15gsmo01297ykf09. Writing only the
     * branch URL meant those links got the generic banner and the site-wide
     * title, which is the exact failure all of this exists to end.
     *
     * The canonical inside every copy still names the branch URL, so search
     * engines are told which one is the address; the other two exist so that a
     * preview bot handed a link somebody actually has gets a real answer.
     */
    const html = render(shell, record, hasCard);
    const addresses = [record.path, `/reference/${record.id}`, `/reference/${record.slug}`];
    for (const address of new Set(addresses)) {
      const dir = join(DIST, address);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, "index.html"), html, "utf8");
    }
  }

  console.log(
    `prerender: wrote ${records.length} record page(s) with their own titles, ` +
      `and ${drawn} share card(s). ${faceLedger.drawn} of ${faceLedger.expected} ` +
      `expected face(s) drawn, from ${portraits.size} distinct people.`,
  );
  if (faceLedger.missing.length) {
    console.warn(
      `prerender: no portrait for ${faceLedger.missing.length} record(s): ` +
        `${faceLedger.missing.slice(0, 8).join(", ")}` +
        `${faceLedger.missing.length > 8 ? ", …" : ""}`,
    );
  }

  /*
   * A FACELESS BATCH IS A FAULT, NOT A RESULT.
   *
   * Three members of Congress genuinely have no portrait on file, and a per
   * curiam ruling has no author to photograph — a few missing faces is the
   * truth. Losing a fifth of them is not: that is an image host throttling or
   * refusing us, and the cards would ship looking finished while saying less
   * than they should. In production that stops the build; the previous
   * deployment keeps serving cards that do have faces.
   */
  const shortfall = faceLedger.expected - faceLedger.drawn;
  if (isProduction && faceLedger.expected > 0 && shortfall / faceLedger.expected > 0.2) {
    console.error(
      `prerender: ${shortfall} of ${faceLedger.expected} portraits could not be ` +
        `downloaded. That is not a handful of people without a photograph, it is ` +
        `an image host refusing us. Refusing to publish cards without their faces.`,
    );
    process.exit(1);
  }
}

await main();
