/**
 * THE FACE ON A LAW CARD BELONGS TO THE PERSON WHO MADE THE DECISION.
 *
 * Every record on the platform was decided by somebody: a bill by its sponsor,
 * an executive order by the President who signed it, a Supreme Court case by
 * the justice who wrote the majority. This file proves the card names the right
 * one, and — more importantly — that it names NOBODY rather than guessing.
 *
 * WHY THERE ARE RECORDED RESPONSES IN tests/fixtures. The roster of officials
 * covers whoever is in office today. It has nothing for an order signed by
 * Obama or an opinion written by Scalia, so those portraits come from
 * Wikipedia, once, at sync time. A test that called Wikipedia would fail on a
 * bad day at their end for reasons that have nothing to do with this code, so
 * the three responses below were fetched once, saved verbatim, and the parsing
 * and the guard are exercised against them.
 *
 * THE ONE THAT MATTERS IS MICHAEL JORDAN. He is not a judge, and there is a
 * federal judge named Jordan. A name lookup with no guard would put a
 * basketball player's photograph on a court ruling and the page would look
 * entirely convincing. His page is here so that the day the guard is loosened,
 * this test says so.
 */

import { describe, expect, test } from "bun:test";
import {
  justiceAttribution,
  portraitFromWikipedia,
  presidentAttribution,
  type WikipediaQueryResponse,
} from "../src/services/reference-attribution";

function fixture(name: string): WikipediaQueryResponse {
  const path = new URL(`./fixtures/wikipedia-${name}.json`, import.meta.url).pathname;
  return JSON.parse(require("fs").readFileSync(path, "utf8")) as WikipediaQueryResponse;
}

describe("a portrait is only accepted for a public official", () => {
  test("a former President is accepted", () => {
    const url = portraitFromWikipedia(fixture("barack-obama"));
    expect(url).toBeTruthy();
    expect(url).toStartWith("https://upload.wikimedia.org/");
  });

  test("a justice who left the bench is accepted", () => {
    const url = portraitFromWikipedia(fixture("antonin-scalia"));
    expect(url).toBeTruthy();
    expect(url).toStartWith("https://upload.wikimedia.org/");
  });

  test("a famous man who never held office is REFUSED", () => {
    // He has a portrait, and 84 categories, and none of them is an office.
    const page = Object.values(fixture("michael-jordan").query?.pages ?? {})[0];
    expect(page?.thumbnail?.source).toBeTruthy();
    expect(portraitFromWikipedia(fixture("michael-jordan"))).toBeNull();
  });

  test("a page with no photograph is null, not an empty string", () => {
    expect(
      portraitFromWikipedia({
        query: { pages: { "1": { title: "Someone", categories: [{ title: "Category:Presidents of the United States" }] } } },
      }),
    ).toBeNull();
  });

  test("an empty or error response is null", () => {
    expect(portraitFromWikipedia({})).toBeNull();
    expect(portraitFromWikipedia({ query: { pages: {} } })).toBeNull();
  });
});

describe("nothing is invented when the person is not known", () => {
  test("A PER CURIAM OPINION NAMES NO JUSTICE — but it is not nobody", () => {
    // The Court speaking as one body. Naming a justice as its author would
    // invent a fact about who decided a case, so none is named.
    //
    // It does not follow that nobody is answerable. "The app is about
    // accountability so not posting the photo is not very fair" — so the
    // record says the Court decided it, and `perCuriam` is what asks the
    // detail endpoint for the bench that sat that day.
    for (const spelling of ["Per Curiam", "per curiam", "PerCuriam"]) {
      const attribution = justiceAttribution(spelling);
      expect(attribution?.name).toBe("The Supreme Court");
      expect(attribution?.perCuriam).toBe(true);
      // No single face, ever. That is the whole point of per curiam.
      expect(attribution?.photoUrl).toBeNull();
    }
  });

  test("a signed opinion is not flagged as per curiam", () => {
    expect(justiceAttribution("Antonin Scalia")?.perCuriam).toBeUndefined();
  });

  test("an absent name is null rather than a blank card", () => {
    expect(presidentAttribution(null)).toBeNull();
    expect(presidentAttribution("   ")).toBeNull();
    expect(justiceAttribution(undefined)).toBeNull();
  });

  test("the portrait is never built here — it is looked up once and stored", () => {
    // There is deliberately no roster lookup in this file any more. A list of
    // current office-holders is wrong the day somebody leaves, and this
    // platform carries fifty years of law.
    expect(justiceAttribution("Learned Hand")).toEqual({
      name: "Learned Hand",
      role: "Majority opinion by",
      photoUrl: null,
    });
    expect(presidentAttribution("Gerald R. Ford")).toEqual({
      name: "Gerald R. Ford",
      role: "Signed by",
      photoUrl: null,
    });
  });
});
