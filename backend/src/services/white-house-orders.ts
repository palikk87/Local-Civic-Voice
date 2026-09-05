/**
 * Executive orders, read from whitehouse.gov the day they are signed.
 *
 * WHY THIS EXISTS. Every executive order on this platform arrived through the
 * Federal Register, and the Register publishes 3 to 7 days after signing —
 * median 5, and one order in the measured set took 48. For those days the
 * platform simply does not have the order. Somebody hears about it on the news,
 * comes here, finds nothing, and concludes we do not carry executive orders.
 *
 * The White House posts the full text the same day. Measured across 83 orders
 * that appear in both places: whitehouse.gov the day of signing, 83 out of 83.
 *
 * SO THIS READS BY DATE, NOT BY DIFFERENCE. The daily pass asks one question —
 * "what was signed on this day?" — and does not care what we already hold or
 * how many orders there are. A day with 26 orders (20 January 2025) and a day
 * with none are the same request.
 *
 * AND IT NEVER READS AN ORDER NUMBER HERE. The White House listing prints one,
 * and on new orders it is wrong: 14420 appeared on two different orders in
 * August 2026, and the Register later called one of them 14421. Numbers come
 * from the Office of the Federal Register, which is the office that assigns
 * them, and from nowhere else. Until one arrives a record carries a starred
 * date instead — see provisionalOrderId below.
 */
import {
  htmlToText,
  officialSourceHeaders,
  sanitizeOfficialText,
} from "./official-source";

/** One order as the White House published it. No number: see the file header. */
export interface WhiteHouseOrder {
  /** The title as whitehouse.gov prints it. */
  title: string;
  /** Signing day, YYYY-MM-DD, Eastern. See signedOn below for why Eastern. */
  signedOn: string;
  /** The order's page on whitehouse.gov. */
  url: string;
  /** The order's own text, chrome and feed furniture removed. */
  fullText: string;
  /** The feed's own identifier, stable across re-publishes of the same item. */
  guid: string;
}

export const EXECUTIVE_ORDER_FEED =
  "https://www.whitehouse.gov/presidential-actions/executive-orders/feed/";

/**
 * The feed carries proclamations and memoranda under other categories; this is
 * the one that means an executive order. Checked per item even though the feed
 * is already scoped to it, because the cost of being wrong is a proclamation
 * stored as an order.
 */
export const EXECUTIVE_ORDER_CATEGORY = "executive orders";

/**
 * Page one is the bare URL, deliberately.
 *
 * `?paged=1` answers 301, not 200. Sending it would either cost a redirect on
 * every single run or, with redirects off, look exactly like the feed being
 * gone. Pages 2 and up are honest 200s carrying 30 items each, walking
 * genuinely backwards — page 2 reaches March 2026, page 5 reaches mid-2025.
 */
export function feedPageUrl(page: number): string {
  return page <= 1 ? EXECUTIVE_ORDER_FEED : `${EXECUTIVE_ORDER_FEED}?paged=${page}`;
}

/**
 * The day an order was signed, in the timezone the White House works in.
 *
 * pubDate is UTC. An order posted at 20:30 Eastern is 00:30 UTC the NEXT day,
 * so reading the UTC date would file a Tuesday order under Wednesday and the
 * daily pass, asking for Tuesday, would never see it. Intl is used rather than
 * a fixed -5 or -4 because the offset changes twice a year and a hardcoded one
 * is wrong for half of it.
 *
 * Measured against the Register's own signing_date: 80 of 82 identical. The two
 * that differ are orders the White House posted late (by one day and by four),
 * never early. So this is the signing date except when the White House itself
 * was slow, and the Register corrects those when it publishes.
 */
export function signedOn(when: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  // en-CA formats as YYYY-MM-DD, which is the shape we store.
  return parts;
}

/**
 * WordPress's numeric entities, which htmlToText does not decode.
 *
 * htmlToText is shared with the bill and Register pipelines and hashes into
 * GovernmentReference.fullTextHash. Teaching it new entities would change the
 * hash of text already stored and rewrite every brief on the platform, so the
 * White House's curly quotes are decoded here instead — where only this reader
 * is affected.
 */
function decodeWordPressEntities(text: string): string {
  return text
    .replace(/&#8216;|&#8217;|&lsquo;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#8230;|&hellip;/g, "...")
    .replace(/&#160;/g, " ");
}

/**
 * The order's own words, out of the feed's HTML payload.
 *
 * WordPress puts the whole rendered page in content:encoded — the site header,
 * the category dropdown, the search box — and then appends its own footer
 * ("The post X appeared first on The White House"). Neither belongs in a record
 * of the law.
 *
 * The two boundaries are real markers, not offsets. Every item in the feed
 * carries exactly one `</nav>`, and the order's first word follows it. The
 * footer is WordPress's own, unchanged since the feed was first published.
 * Checked across 30 items: all 30 start with "By the authority vested in me"
 * immediately after the nav.
 */
export function orderBody(contentEncoded: string): string {
  let markup = contentEncoded;

  const navEnd = markup.lastIndexOf("</nav>");
  if (navEnd >= 0) markup = markup.slice(navEnd + "</nav>".length);

  const footer = markup.lastIndexOf("<p>The post ");
  if (footer >= 0) markup = markup.slice(0, footer);

  /*
   * THE SIGNED PDF IS AN ATTACHMENT, NOT THE ORDER.
   *
   * Once the signed copy exists the White House re-publishes the post with a
   * file widget bolted on, and the widget's link text is the PDF's name —
   * "eo-14422", "Download". Left in, three things go wrong: an order number we
   * have explicitly refused to take from this source is written into the law's
   * own text; the brief is generated from text ending in "Download"; and the
   * republished copy no longer fingerprints the same as the copy we already
   * hold, so the same order becomes two records with a split vote.
   *
   * That last one is not hypothetical. The White House published "Establishing
   * an America First Arms Transfer Strategy" twice — two post ids, two URLs —
   * and the two texts are identical through 10,273 characters, differing only
   * by this widget.
   */
  markup = markup.replace(
    /<div[^>]*class="[^"]*\bwp-block-file\b[^"]*"[\s\S]*?<\/div>/gi,
    " ",
  );

  return sanitizeOfficialText(decodeWordPressEntities(htmlToText(markup)));
}

function tagText(block: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = pattern.exec(block);
  if (!match?.[1]) return null;
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(match[1]);
  return cdata?.[1] ?? match[1];
}

function categoriesOf(block: string): string[] {
  const found = block.match(/<category[^>]*>[\s\S]*?<\/category>/gi) ?? [];
  return found.map((raw) => {
    const inner = /^<category[^>]*>([\s\S]*?)<\/category>$/i.exec(raw)?.[1] ?? "";
    const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(inner);
    return (cdata?.[1] ?? inner).trim().toLowerCase();
  });
}

/**
 * Read a feed page into orders. Pure — no network, so it can be tested against
 * the captured feed in tests/fixtures/wh-eo-feed.xml.
 *
 * An item missing a date, a title or a body is dropped rather than stored half
 * empty. A record of a law with no text is worse than no record: it looks like
 * we have the order and cannot show it.
 */
export function parseOrderFeed(xml: string): WhiteHouseOrder[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  const orders: WhiteHouseOrder[] = [];

  for (const block of blocks) {
    if (!categoriesOf(block).includes(EXECUTIVE_ORDER_CATEGORY)) continue;

    const published = tagText(block, "pubDate");
    const when = published ? new Date(published) : null;
    if (!when || Number.isNaN(when.getTime())) continue;

    const rawTitle = tagText(block, "title");
    const title = rawTitle ? decodeWordPressEntities(htmlToText(rawTitle)) : "";
    if (!title) continue;

    const encoded = tagText(block, "content:encoded");
    const fullText = encoded ? orderBody(encoded) : "";
    if (!fullText) continue;

    orders.push({
      title,
      signedOn: signedOn(when),
      url: (tagText(block, "link") ?? "").trim(),
      fullText,
      guid: (tagText(block, "guid") ?? "").trim(),
    });
  }

  return orders;
}

/**
 * How far back a single day's request will walk before giving up.
 *
 * A page holds 30 items and reaches roughly six months back, so four pages is
 * two years — far past any lateness the White House has ever shown. The walk
 * normally stops on page one: it only continues while items are still NEWER
 * than the day asked for, which happens when nothing has been signed in a
 * while.
 */
export const MAX_FEED_PAGES = 4;

/**
 * Every order the White House says was signed on this day.
 *
 * NULL MEANS WE COULD NOT ASK, and an empty array means nobody signed anything.
 * Collapsing those two would be the worst bug available here: a feed outage
 * would read as a quiet day, the pass would move on, and the orders signed that
 * day would never be picked up by anything.
 */
export async function fetchOrdersSignedOn(
  day: string,
  maxPages: number = MAX_FEED_PAGES,
): Promise<WhiteHouseOrder[] | null> {
  const found: WhiteHouseOrder[] = [];
  let reachedSource = false;

  for (let page = 1; page <= maxPages; page++) {
    let orders: WhiteHouseOrder[];
    try {
      const response = await fetch(feedPageUrl(page), {
        headers: officialSourceHeaders({ Accept: "application/rss+xml, application/xml" }),
        signal: AbortSignal.timeout(20_000),
      });
      // A page past the end of the feed is a 404, which ends the walk without
      // being a failure — everything earlier still counts.
      if (response.status === 404 && reachedSource) break;
      if (!response.ok) return reachedSource ? found : null;
      orders = parseOrderFeed(await response.text());
    } catch {
      return reachedSource ? found : null;
    }

    reachedSource = true;
    if (orders.length === 0) break;

    /*
     * Pages overlap. Page 2 of the feed ended on 11 December 2025 and page 3
     * began on it, so an order sitting on a page boundary is served twice —
     * and a day that lands there would be ingested twice without this.
     *
     * Keyed on the URL, which is the post itself. NOT on title and date: the
     * White House has published one order under two posts with two URLs, and
     * that is a real duplicate for the merge machinery to decide on, not a
     * paging artefact for this loop to silently drop.
     */
    for (const order of orders) {
      if (order.signedOn !== day) continue;
      if (found.some((held) => held.url === order.url)) continue;
      found.push(order);
    }

    // The feed runs newest first, so once a page ends older than the day we
    // asked for, no later page can hold it.
    const oldest = orders[orders.length - 1];
    if (oldest && oldest.signedOn < day) break;
  }

  return reachedSource ? found : null;
}

/**
 * The name a record carries until the Federal Register gives it a number.
 *
 * SHAPE. `eo-2026-09-04*`, then `eo-2026-09-04-2*`, `eo-2026-09-04-3*`. The
 * star is not decoration: it is what keeps our placeholder from occupying the
 * name of the real order, and `clean()` in master-reference-id.ts passes it
 * through untouched, so `eo-14424*` and `eo-14424` are two distinct keys and
 * neither can be mistaken for the other.
 *
 * NO SLASHES. `eo-2026-09-04/2*` reads well and breaks the first time an id
 * reaches a URL path or a filename. The hyphen says the same thing and cannot.
 *
 * SEQUENTIAL AGAINST WHAT WE HOLD, not against feed position. If `...-2*` is
 * already taken the next one is `...-3*`, whether or not the record holding it
 * came from the same run. Two passes over one day must not collide.
 */
export function provisionalOrderId(day: string, taken: (id: string) => boolean): string {
  const first = `eo-${day}*`;
  if (!taken(first)) return first;

  // No bound worth enforcing: the busiest day on record signed 26 orders, and a
  // day that somehow signed a thousand should still get a thousand names.
  for (let n = 2; ; n++) {
    const id = `eo-${day}-${n}*`;
    if (!taken(id)) return id;
  }
}

/**
 * A title reduced to the thing both sides agree on.
 *
 * The White House and the Federal Register print the same order under titles
 * that are usually identical and occasionally not. Measured across 83 orders in
 * both places, 80 matched character for character. All three that did not were
 * the Register's:
 *
 *   WH  ...Glyphosate-Based Herbicides
 *   FR  ...Glyphosate- Based Herbicides      a hyphen broken across a line
 *
 *   WH  ...Federal Labor-Management Relations Program
 *   FR  ...Federal Labor- Management Relations Program
 *
 *   WH  ...the Reciprocal Tariff with Respect to...
 *   FR  ...the Reciprocal Tariffs With Respect to...
 *
 * So two of the three are typesetting damage and one is house style plus a
 * plural. Repairing the broken hyphen and folding a trailing "s" turns all
 * three into matches, which is why both happen here and neither is a guess
 * about meaning.
 */
export function orderTitleKey(title: string): string {
  return title
    .toLowerCase()
    // "labor- management" is one word the Register's typesetter split. Only
    // when a letter follows, so a genuine dash between words is left alone.
    .replace(/([a-z0-9])-\s+(?=[a-z0-9])/g, "$1-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    // Fold a trailing plural: "tariff" and "tariffs" are the same word here.
    // "ss" is left alone so "congress" does not become "congres".
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .join(" ");
}

/**
 * How much two titles have in common, 0 to 1.
 *
 * The fallback for when orderTitleKey does not match exactly — a word inserted,
 * a word dropped. Deliberately a blunt instrument used with a high threshold:
 * two orders signed on one day about neighbouring subjects ("Promoting Fair
 * Competition In Livestock Markets" and "Supporting America's Ranchers", both
 * 4 September 2026) must never be mistaken for each other.
 */
export function titleCloseness(left: string, right: string): number {
  const a = new Set(orderTitleKey(left).split(" ").filter(Boolean));
  const b = new Set(orderTitleKey(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared++;
  return shared / Math.max(a.size, b.size);
}

/** Is this the placeholder name of an order still waiting for its number? */
export function isProvisionalOrderId(masterReferenceId: string): boolean {
  return masterReferenceId.trim().endsWith("*");
}
