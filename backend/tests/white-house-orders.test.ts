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
  parseOrderFeed,
  provisionalOrderId,
  signedOn,
} from "../src/services/white-house-orders";

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
