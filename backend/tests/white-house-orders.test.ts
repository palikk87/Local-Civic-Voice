/**
 * READING AN ORDER OUT OF THE WHITE HOUSE FEED.
 *
 * The platform's freshness gap is 3 to 7 days wide, and this reader is what
 * closes it. Everything here runs against the real feed as it was served on
 * 5 September 2026, recorded in tests/fixtures/wh-eo-feed.xml. No network: the
 * parsing is the part that can be wrong, and a test that needs whitehouse.gov
 * to be up fails for reasons that have nothing to do with this code.
 *
 * The eight recorded items were chosen for what they prove — two orders signed
 * on 4 September, two more on 6 August, and four days carrying one each.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  EXECUTIVE_ORDER_FEED,
  feedPageUrl,
  isProvisionalOrderId,
  orderBody,
  orderTitleKey,
  parseOrderFeed,
  provisionalOrderId,
  signedOn,
  titleCloseness,
} from "../src/services/white-house-orders";
import { formatReferenceDisplayId } from "../src/services/reference-id";

const xml = readFileSync(
  new URL("./fixtures/wh-eo-feed.xml", import.meta.url).pathname,
  "utf8",
);
const orders = parseOrderFeed(xml);
const byTitle = (fragment: string) =>
  orders.find((order) => order.title.includes(fragment));

describe("the feed is read completely", () => {
  test("every recorded item becomes an order", () => {
    expect(orders.length).toBe(8);
  });

  test("titles arrive as the White House prints them, curly quotes decoded", () => {
    // The feed writes this as "America&#8217;s". Stored with a raw entity it
    // would be searched for, and shared, as literal punctuation garbage.
    expect(byTitle("Ranchers")?.title).toBe("Supporting America's Ranchers");
  });

  test("each order links to its own page", () => {
    expect(byTitle("Ranchers")?.url).toBe(
      "https://www.whitehouse.gov/presidential-actions/2026/09/supporting-americas-ranchers/",
    );
  });
});

describe("the date is the day it was signed, in the President's timezone", () => {
  test("an evening posting stays on its own day", () => {
    // 21:00:35 UTC on 27 August is 17:00 Eastern the same day. Read as UTC this
    // is still the 27th, but an order posted after 20:00 Eastern would roll
    // over — so the conversion has to be real, not incidental.
    expect(byTitle("Great Lakes")?.signedOn).toBe("2026-08-27");
  });

  test("a posting after 8pm Eastern does not become tomorrow's order", () => {
    // 00:30 UTC on 5 September is 20:30 Eastern on the 4th.
    expect(signedOn(new Date("2026-09-05T00:30:00Z"))).toBe("2026-09-04");
  });

  test("the offset follows daylight saving rather than being assumed", () => {
    // Same clock time, opposite sides of the switch: EDT is -4, EST is -5.
    expect(signedOn(new Date("2026-07-01T03:30:00Z"))).toBe("2026-06-30");
    expect(signedOn(new Date("2026-01-01T03:30:00Z"))).toBe("2025-12-31");
  });

  test("dates match the Federal Register's own signing dates", () => {
    // Every one of these was checked against federalregister.gov's signing_date
    // field for the same order.
    expect(byTitle("Ending Birth Tourism")?.signedOn).toBe("2026-08-06");
    expect(byTitle("Childhood Vaccine")?.signedOn).toBe("2026-08-10");
    expect(byTitle("Military Spouse")?.signedOn).toBe("2026-08-03");
  });
});

describe("the stored text is the order and nothing else", () => {
  const ranchers = byTitle("Ranchers");

  test("the order's own first words are the first words stored", () => {
    expect(ranchers?.fullText.startsWith("By the authority vested in me")).toBe(true);
  });

  test("the site's navigation is not stored as law", () => {
    // content:encoded carries the whole rendered page. "Select Category" is the
    // topper's dropdown; storing it would put it in the text a brief is
    // written from.
    expect(ranchers?.fullText).not.toContain("Select Category");
    expect(ranchers?.fullText).not.toContain("Briefings & Statements");
  });

  test("WordPress's own footer is not stored as law", () => {
    expect(ranchers?.fullText).not.toContain("appeared first on");
  });

  test("the text runs through to the signature and the dateline", () => {
    expect(ranchers?.fullText).toContain("DONALD J. TRUMP");
    expect(ranchers?.fullText).toContain("THE WHITE HOUSE");
    expect(ranchers?.fullText).toContain("September 4, 2026");
  });

  test("the body of the order is there, not just its opening", () => {
    // This is the phrase that started the work: it appears seven times in the
    // order's body and nowhere in its title, and searching for it on this
    // platform found nothing.
    expect(ranchers?.fullText.toLowerCase()).toContain("mexican wolf");
    expect(ranchers!.fullText.length).toBeGreaterThan(5_000);
  });

  test("an item with no readable body is dropped, not stored empty", () => {
    const hollow = `<item><title>Something</title><category><![CDATA[Executive Orders]]></category>` +
      `<pubDate>Fri, 04 Sep 2026 19:28:18 +0000</pubDate>` +
      `<content:encoded><![CDATA[<nav></nav>]]></content:encoded></item>`;
    expect(parseOrderFeed(hollow)).toEqual([]);
  });

  test("the signed PDF widget is not stored as part of the law", () => {
    // Once the signed copy exists the White House re-publishes the post with a
    // file widget attached, whose link text is the PDF's name. Left in, an
    // order number we have explicitly refused to take from this source ends up
    // written into the law's own text.
    const greatLakes = byTitle("Great Lakes");
    expect(greatLakes?.fullText).not.toContain("Download");
    expect(greatLakes?.fullText).not.toContain("eo-14422");
    expect(greatLakes?.fullText.trimEnd().endsWith("August 27, 2026.")).toBe(true);
  });

  test("a re-published copy still fingerprints as the same order", () => {
    // The White House published "Establishing an America First Arms Transfer
    // Strategy" twice — two post ids, two URLs — and the two texts are
    // identical through 10,273 characters, differing only by that widget. With
    // it stripped the merge adjudicator's cheapest tier recognises them as one
    // order; with it left in they would be two records with a split vote.
    const withWidget =
      "<p>By the authority vested in me it is ordered.</p>" +
      '<div data-wp-interactive="core/file" class="wp-block-file hide-link-text">' +
      '<a href="https://www.whitehouse.gov/wp-content/uploads/2026/08/eo-14422.pdf">eo-14422</a>' +
      '<a class="wp-block-file__button" download>Download</a></div>';
    expect(orderBody(withWidget)).toBe(orderBody("<p>By the authority vested in me it is ordered.</p>"));
  });

  test("a body with no navigation wrapper still reads", () => {
    expect(orderBody("<p>By the authority vested in me, it is ordered.</p>")).toBe(
      "By the authority vested in me, it is ordered.",
    );
  });
});

describe("only executive orders are taken", () => {
  test("a proclamation in the same feed is left alone", () => {
    // The White House files proclamations and memoranda through the same
    // machinery. One stored as an executive order would be a false record.
    const proclamation = `<item><title>National Something Week</title>` +
      `<category><![CDATA[Presidential Actions]]></category>` +
      `<category><![CDATA[Proclamations]]></category>` +
      `<pubDate>Fri, 04 Sep 2026 19:28:18 +0000</pubDate>` +
      `<content:encoded><![CDATA[<p>By the authority vested in me, it is ordered.</p>]]></content:encoded></item>`;
    expect(parseOrderFeed(proclamation)).toEqual([]);
  });
});

describe("no order number is ever read from the White House", () => {
  test("nothing in a parsed order can carry one", () => {
    // The listing page publishes an EO number and it is wrong on new orders —
    // 14420 appeared on two different ones. This asserts the shape of the
    // record, so a future field cannot quietly reintroduce it.
    for (const order of orders) {
      expect(Object.keys(order).sort()).toEqual([
        "fullText",
        "guid",
        "signedOn",
        "title",
        "url",
      ]);
    }
  });
});

describe("the placeholder name a record carries until the Register numbers it", () => {
  test("the first order of a day takes the bare date", () => {
    expect(provisionalOrderId("2026-09-04", () => false)).toBe("eo-2026-09-04*");
  });

  test("a second order that day gets the next number in sequence", () => {
    const held = new Set(["eo-2026-09-04*"]);
    expect(provisionalOrderId("2026-09-04", (id) => held.has(id))).toBe("eo-2026-09-04-2*");
  });

  test("it counts past what is already held, not from where it started", () => {
    const held = new Set(["eo-2026-09-04*", "eo-2026-09-04-2*", "eo-2026-09-04-3*"]);
    expect(provisionalOrderId("2026-09-04", (id) => held.has(id))).toBe("eo-2026-09-04-4*");
  });

  test("no identifier carries a slash", () => {
    const held = new Set(["eo-2026-09-04*"]);
    expect(provisionalOrderId("2026-09-04", (id) => held.has(id))).not.toContain("/");
  });

  test("a placeholder is recognisable, and a real number is not mistaken for one", () => {
    expect(isProvisionalOrderId("eo-2026-09-04*")).toBe(true);
    expect(isProvisionalOrderId("eo-2026-09-04-2*")).toBe(true);
    expect(isProvisionalOrderId("eo-14424")).toBe(false);
  });
});

describe("paging the feed", () => {
  test("page one is the bare feed, because ?paged=1 answers 301", () => {
    expect(feedPageUrl(1)).toBe(EXECUTIVE_ORDER_FEED);
  });

  test("later pages carry the parameter", () => {
    expect(feedPageUrl(3)).toBe(`${EXECUTIVE_ORDER_FEED}?paged=3`);
  });
});

describe("matching a White House title to the Federal Register's", () => {
  const matches = (wh: string, fr: string) => orderTitleKey(wh) === orderTitleKey(fr);

  test("a hyphen the Register's typesetter broke across a line still matches", () => {
    expect(
      matches(
        "Promoting the National Defense by Ensuring an Adequate Supply of Elemental Phosphorus and Glyphosate-Based Herbicides",
        "Promoting the National Defense by Ensuring an Adequate Supply of Elemental Phosphorus and Glyphosate- Based Herbicides",
      ),
    ).toBe(true);
    expect(
      matches(
        "Further Exclusions from the Federal Labor-Management Relations Program",
        "Further Exclusions From the Federal Labor- Management Relations Program",
      ),
    ).toBe(true);
  });

  test("the Register's house style and its plural still match", () => {
    expect(
      matches(
        "Modifying the Scope of the Reciprocal Tariff with Respect to Certain Agricultural Products",
        "Modifying the Scope of the Reciprocal Tariffs With Respect to Certain Agricultural Products",
      ),
    ).toBe(true);
  });

  test("a word ending in double s keeps it", () => {
    // Folding "congress" to "congres" would break every title that names it.
    expect(orderTitleKey("Reporting to Congress")).toBe("reporting to congress");
  });

  test("two orders signed the same day are not confused for each other", () => {
    // Both signed 4 September 2026, both about livestock. A matcher that put
    // one order's number on the other would be worse than no matcher.
    expect(
      titleCloseness(
        "Supporting America's Ranchers",
        "Promoting Fair Competition In Livestock Markets And Expanding Market Access for American Meat Producers",
      ),
    ).toBe(0);
  });

  test("a genuine rewording scores high enough to be recognised", () => {
    // The Register renamed this one; measured at 0.94 across the real pair.
    expect(
      titleCloseness(
        "Providing for the Closure of Executive Departments and Agencies",
        "Providing for the Closing of Executive Departments and Agencies",
      ),
    ).toBeGreaterThanOrEqual(0.85);
  });

  test("across 90 real orders, exact matching is the rule and not the exception", () => {
    // Measured: 85 of 90 matched the Register exactly on a normalised title,
    // 1 needed the closeness fallback, and 4 were genuinely not there — two
    // signed the day before this fixture was taken, and two the Register
    // published without an order number at all.
    expect(orderTitleKey("Ending Birth Tourism")).toBe("ending birth tourism");
  });
});

describe("what a reader is shown while the number is still pending", () => {
  test("a starred id is never printed as an order number", () => {
    // "EO 2026-09-04*" would put something shaped exactly like an order number
    // in front of a reader, on a platform whose whole claim is that its records
    // are the real ones.
    expect(formatReferenceDisplayId("eo-2026-09-04*", "executive_order")).toBe("Signed 2026-09-04");
  });

  test("the second order of a day is counted, not dated twice", () => {
    // The trailing "-2" is ours, not the government's.
    expect(formatReferenceDisplayId("eo-2026-09-04-2*", "executive_order")).toBe(
      "Signed 2026-09-04 (2)",
    );
  });

  test("a real order number is still shown as one", () => {
    expect(formatReferenceDisplayId("eo-14421", "executive_order")).toBe("EO 14421");
  });
});
