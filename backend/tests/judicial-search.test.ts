/**
 * The judicial branch translates a citizen's question into a court's language.
 *
 * EVERY NUMBER BELOW IS RECORDED FROM THE LIVE COURTLISTENER API, asking the
 * same person's question three ways:
 *
 *   q = can the government make you get a vaccine        (what it did)
 *     → 1,098 hits led by "Make The Road New York v. Kristi Noem"
 *
 *   q = "compulsory vaccination", all federal courts
 *     → 290 hits led by district-court disputes
 *
 *   q = "compulsory vaccination", Supreme Court
 *     → 12 hits including Jacobson v. Massachusetts (1905) — the case that
 *       actually decides the question that was asked
 *
 * Both halves matter, and the second was learned by getting it wrong. The
 * phrase alone is not enough; a citizen asking what the law IS is asking about
 * the court that settles it, so the Supreme Court is asked first and the rest
 * of the federal courts after. Rank order, not scope: nothing is removed.
 *
 * TWO REQUESTS PER SEARCH, because CourtListener allows five a minute per
 * account — a ceiling one reader can hit by searching twice.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
// First, for its side effect: sets DATABASE_URL before Prisma is constructed.
import "./helpers/server";
import { buildLadder, searchJudicialOpinions } from "../src/services/judicial-search";
import { plainIntent } from "../src/services/search-intent";

import rawProse from "./fixtures/cl-search-raw-prose.json";
import phraseAllCourts from "./fixtures/cl-search-phrase.json";
import phraseScotus from "./fixtures/cl-search-phrase-scotus.json";
import phoneFamily from "./fixtures/cl-search-phone-privacy-family.json";

const realFetch = globalThis.fetch;
const QUESTION = "can the government make you get a vaccine";

const GOOD_INTENT = {
  topic: "compulsory vaccination",
  phrases: ["compulsory vaccination"],
  terms: ["vaccination", "mandate", "police power"],
  caseNames: [],
  bills: [],
  from: null,
  to: null,
};

let asked: string[] = [];

interface StubOptions {
  intent: Record<string, unknown> | null;
  /** Answer the first N CourtListener calls with a throttle. */
  throttleFirst?: number;
  /** Answer a caseName rung with nothing, as if the case does not exist. */
  emptyCaseName?: boolean;
}

function stub({ intent, throttleFirst = 0, emptyCaseName = false }: StubOptions): void {
  asked = [];
  let throttled = 0;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
      if (!intent) return new Response("upstream unavailable", { status: 503 });
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(intent) }] } }],
      });
    }

    if (url.includes("courtlistener.com")) {
      if (throttled < throttleFirst) {
        throttled++;
        return new Response(
          JSON.stringify({
            detail: "Request was throttled. Rate limit exceeded: 5/min. Expected available in 1 second.",
          }),
          { status: 429 },
        );
      }
      asked.push(url);
      const params = new URL(url).searchParams;
      const q = params.get("q") ?? "";

      /*
       * WHAT court=scotus ACTUALLY DOES TO A RESPONSE.
       *
       * These fixtures are real recorded answers, and two of them were recorded
       * from an UNSCOPED search — cl-search-raw-prose.json is five results and
       * not one of them is the Supreme Court: the D.C. Circuit, two Texas
       * Courts of Appeals, the Court of Federal Claims, the Tennessee Supreme
       * Court. That is what the old ladder was putting in front of readers, and
       * what could then be opened and filed as a ruling of the Supreme Court.
       *
       * Serving them back unfiltered would test a request this code can no
       * longer make. So the stub filters by court the way the API does, which
       * keeps the recorded data honest and lets the emptiness show.
       */
      const scoped = (fixture: { count?: number; results?: Array<{ court_id?: string }> }) => {
        if (params.get("court") !== "scotus") return Response.json(fixture);
        const results = (fixture.results ?? []).filter((r) => r.court_id === "scotus");
        return Response.json({ ...fixture, count: results.length, results });
      };

      if (q.startsWith("caseName:")) {
        return emptyCaseName ? Response.json({ count: 0, results: [] }) : scoped(phraseScotus);
      }
      if (!q.includes('"')) return scoped(rawProse);
      return scoped(params.get("court") === "scotus" ? phraseScotus : phraseAllCourts);
    }

    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

beforeAll(() => {
  process.env.GEMINI_API_KEY ??= "test-key-never-sent-anywhere";
  process.env.COURTLISTENER_API_KEY ??= "test-token-never-sent-anywhere";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("judicial search", () => {
  test("asks the Supreme Court first, in the words a ruling uses", async () => {
    stub({ intent: GOOD_INTENT });
    await searchJudicialOpinions(QUESTION, 10);

    const first = new URL(asked[0] ?? "");
    expect(first.searchParams.get("q")).toBe('"compulsory vaccination"');
    expect(first.searchParams.get("court")).toBe("scotus");
    // Never the sentence the reader typed.
    expect(first.searchParams.get("q")).not.toContain("make you get");
  });

  test("Jacobson v. Massachusetts reaches the reader", async () => {
    // The whole point, in one assertion. The old search returned
    // "Make The Road New York v. Kristi Noem" for this question.
    stub({ intent: GOOD_INTENT });
    const output = await searchJudicialOpinions(QUESTION, 10);

    const names = output.results.map((r) => r.case_name);
    expect(names).toContain("Jacobson v. Massachusetts");
    expect(names).not.toContain("Make The Road New York v. Kristi Noem");
  });

  test("a landmark outranks a fresher case that matched less well", async () => {
    // Prominence orders; it does not admit. A 1905 opinion can be the
    // controlling law on a question asked today, so courts are ranked by how
    // often they are cited rather than by how recent they are — ranking a
    // court's work by freshness buries exactly what a citizen is looking for.
    stub({ intent: GOOD_INTENT });
    const output = await searchJudicialOpinions(QUESTION, 10);

    const jacobson = output.results.findIndex((r) => r.case_name === "Jacobson v. Massachusetts");
    expect(jacobson).toBeGreaterThanOrEqual(0);
    expect(jacobson).toBeLessThan(5);
  });

  test("spends at most two requests, because five a minute is the ceiling", async () => {
    stub({ intent: GOOD_INTENT });
    await searchJudicialOpinions(QUESTION, 10);
    expect(asked.length).toBeLessThanOrEqual(2);
  });

  test("waits out a throttle instead of reporting an empty court", async () => {
    // A 429 is not "no cases about this". Treating it as one is how a
    // published opinion two seconds away becomes a question with no answer.
    stub({ intent: GOOD_INTENT, throttleFirst: 1 });
    const output = await searchJudicialOpinions(QUESTION, 10);

    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results.map((r) => r.case_name)).toContain("Jacobson v. Massachusetts");
  });

  test("a case the model named but CourtListener does not have is dropped silently", async () => {
    // THE LINE. A model asked about vaccine law will name cases with total
    // confidence, and some of them do not exist. A case name is a LEAD: it is
    // asked of CourtListener, and if nothing comes back the reader is never
    // told about it. On a civics platform an invented precedent is worse than
    // an empty page.
    stub({
      intent: { ...GOOD_INTENT, caseNames: ["Wilkerson v. Board of Public Health"] },
      emptyCaseName: true,
    });
    const output = await searchJudicialOpinions(QUESTION, 10);

    expect(output.results.map((r) => r.case_name)).not.toContain(
      "Wilkerson v. Board of Public Health",
    );
    // And every result that IS shown came back from the API.
    const real = new Set(
      [...phraseScotus.results, ...phraseAllCourts.results, ...rawProse.results].map(
        (r) => r.caseName,
      ),
    );
    for (const result of output.results) expect(real.has(result.case_name)).toBe(true);
  });

  test("still searches when the model is unavailable", async () => {
    stub({ intent: null });
    const output = await searchJudicialOpinions(QUESTION, 10);

    expect(output.intent.interpreted).toBe(false);
    expect(asked.length).toBeGreaterThan(0);
  });
});

describe("nothing but the Supreme Court leaves this building", () => {
  test("EVERY REQUEST CARRIES court=scotus, WHATEVER WAS TYPED", async () => {
    /*
     * The ladder test above proves there is no unscoped rung. This proves the
     * thing that actually matters: the URL. The filter is set unconditionally in
     * urlFor now, so no rung, no intent and no future field can reach past it.
     *
     * It is asserted on the wire rather than on the ladder because that is where
     * the failure happened — the rungs looked reasonable and the requests went
     * out to the whole federal judiciary.
     */
    for (const query of [
      "compulsory vaccination",
      "Jacobson v. Massachusetts",
      "phone privacy",
      "location information disclosure order",
      "",
    ]) {
      stub({ intent: null });
      await searchJudicialOpinions(query || "anything", 5).catch(() => undefined);
      expect(asked.length, `"${query}" asked nothing`).toBeGreaterThan(0);
      for (const url of asked) {
        expect(new URL(url).searchParams.get("court"), `"${query}" -> ${url}`).toBe("scotus");
      }
    }
  });
});

describe("THE GUARD: a lower court never reaches a reader", () => {
  /*
   * The request is scoped and the ingest refuses another court. This is the
   * guard on the middle step, and the only one that does not depend on anybody
   * else keeping their word: even if CourtListener ignores court=scotus and
   * answers with the whole federal judiciary, none of it is shown.
   *
   * It matters because a result a reader can SEE is a result a reader can open,
   * and opening a judicial document files it as a ruling of the Supreme Court.
   * That is how a Maryland magistrate judge's order came to be published here.
   *
   * The fixture is a real recorded answer to a real query from this search, and
   * every one of its five results is a court we must never publish:
   *
   *   cadc      Make The Road New York v. Kristi Noem
   *   txctapp2  Jonathan Stickland ... v. Texans for Vaccine Choice
   *   txctapp1  In Re C.J.S., a Child v. the State of Texas
   *   uscfc     A. v. Secretary of Health and Human Services
   *   tenn      Thomas Fleming Mabry v. ... the Tennessee Supreme Court
   *
   * Note the last one. It is a STATE supreme court — which is why the court's
   * display name can never be the test, and the id has to be.
   */
  test("NOT ONE RESULT SURVIVES WHEN THE SOURCE IGNORES THE FILTER", async () => {
    asked = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
        return new Response("upstream unavailable", { status: 503 });
      }
      if (url.includes("courtlistener.com")) {
        asked.push(url);
        // Deliberately unfiltered: the whole recorded page, court=scotus ignored.
        return Response.json(rawProse);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const output = await searchJudicialOpinions("vaccine mandates", 20);

    expect(asked.length).toBeGreaterThan(0);
    expect(output.results).toEqual([]);
  });

  test("A RULING THAT TALKS ABOUT LOWER COURTS IS STILL A SUPREME COURT RULING", async () => {
    /*
     * The guard must not be fooled by what a case is ABOUT.
     *
     * Almost every Supreme Court ruling reviews a lower court, so its name and
     * its text are full of them: Rodriguez v. United States — one of the
     * rulings this platform actually holds — reviews the Eighth Circuit and
     * says so repeatedly. A guard that read the title, the snippet or the
     * description would throw out most of the Supreme Court's work.
     *
     * So it reads exactly one thing: court_id, CourtListener's machine id for
     * the court that ISSUED the opinion. Nothing else is consulted, and this
     * fixture is built to punish anything that does.
     */
    asked = [];
    const talksAboutLowerCourts = {
      count: 1,
      results: [
        {
          cluster_id: 999002,
          caseName: "Rodriguez v. United States (on certiorari to the Eighth Circuit)",
          court: "Supreme Court of the United States",
          court_id: "scotus",
          dateFiled: "2015-04-21",
          docketNumber: "13-9972",
          absolute_url: "/opinion/2795278/rodriguez-v-united-states/",
          opinions: [
            {
              id: 2795278,
              snippet:
                "The Eighth Circuit affirmed. The District Court adopted the Magistrate Judge's " +
                "recommendation. We granted certiorari to resolve a split among the Courts of " +
                "Appeals, including the Ninth Circuit and the Tennessee Supreme Court.",
            },
          ],
        },
      ],
    };
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
        return new Response("upstream unavailable", { status: 503 });
      }
      if (url.includes("courtlistener.com")) {
        asked.push(url);
        return Response.json(talksAboutLowerCourts);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const output = await searchJudicialOpinions("traffic stop dog sniff", 20);

    expect(output.results.length).toBe(1);
    expect(output.results[0]!.case_name).toContain("Rodriguez v. United States");
  });

  test("a Supreme Court ruling in the same answer still gets through", async () => {
    // The guard must drop the lower courts, not the search. A filter that
    // returns nothing at all would be indistinguishable from a broken source.
    asked = [];
    const mixed = {
      count: 2,
      results: [
        ...(rawProse.results ?? []).slice(0, 2),
        {
          cluster_id: 999001,
          caseName: "A Real Supreme Court Ruling",
          court: "Supreme Court of the United States",
          court_id: "scotus",
          dateFiled: "2026-06-30",
          docketNumber: "25-999",
          absolute_url: "/opinion/999001/a-real-supreme-court-ruling/",
          opinions: [{ id: 999001, snippet: "Held: the guard lets this through." }],
        },
      ],
    };
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
        return new Response("upstream unavailable", { status: 503 });
      }
      if (url.includes("courtlistener.com")) {
        asked.push(url);
        return Response.json(mixed);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;

    const output = await searchJudicialOpinions("vaccine mandates", 20);
    const names = output.results.map((r) => r.case_name);

    expect(names).toContain("A Real Supreme Court Ruling");
    expect(names).not.toContain("Make The Road New York v. Kristi Noem");
    expect(output.results.every((r) => r.court_id === "scotus")).toBe(true);
  });
});

describe("the judicial ladder", () => {
  test("a named case still leads the ladder", () => {
    const intent = {
      ...plainIntent("the vaccine case", "judicial"),
      caseNames: ["Jacobson v. Massachusetts"],
      phrases: ["compulsory vaccination"],
      interpreted: true,
    };
    const ladder = buildLadder(intent);

    expect(ladder[0]!.q).toBe('caseName:("Jacobson v. Massachusetts")');
  });

  test("THERE IS NO LONGER AN ALL-COURTS RUNG, FOR ANY QUERY", () => {
    /*
     * There used to be two rungs per query — one scoped to the Supreme Court
     * and one deliberately not — and the ladder was described as reaching
     * "every federal court", with the Supreme Court merely asked first.
     *
     * A result from the unscoped rung could be opened, and opening a judicial
     * document files it as a scotus_case. That published a Maryland magistrate
     * judge's order as a ruling of the Supreme Court of the United States.
     * Ranking did not save it: being second on a list is still being on it.
     */
    for (const intent of [
      { ...plainIntent("vaccine mandates", "judicial"), phrases: ["compulsory vaccination"], interpreted: true },
      { ...plainIntent("privacy", "judicial"), topic: "phone privacy", interpreted: true },
      { ...plainIntent("something nobody parsed", "judicial") },
      {
        ...plainIntent("the vaccine case", "judicial"),
        caseNames: ["Jacobson v. Massachusetts"],
        phrases: ["compulsory vaccination"],
        topic: "vaccines",
        interpreted: true,
      },
    ]) {
      const ladder = buildLadder(intent);
      expect(ladder.length).toBeGreaterThan(0);
      for (const rung of ladder) {
        expect(rung.label, `"${rung.label}" still offers an unscoped search`).not.toContain("all courts");
      }
      // The scope is not a rung's to choose any more, so there is no field on a
      // rung that could carry another court.
      expect(ladder.every((rung) => !("court" in rung))).toBe(true);
    }
  });
});

/**
 * The bar is a plain Google search.
 *
 * Asked "scotus case about cell phone privacy", Google's overview names three
 * cases: Chatrie v. United States (June 2026, geofence warrants), Carpenter v.
 * United States (2018, cell-site records) and Riley v. California (2014,
 * searching a phone on arrest).
 *
 * The first version of this search found two of them and buried the third, for
 * two separate reasons — both fixed here, both provable against the recorded
 * response in cl-search-phone-privacy-family.json.
 */
describe("matching what a plain web search returns", () => {
  const familyIntent = {
    topic: "cell phone privacy",
    // The doctrinal FAMILY, not the single most precise term. Asking only for
    // "cell site location information" reaches Carpenter and Chatrie and misses
    // Riley entirely, because Riley is decided under a different doctrine with
    // different words.
    phrases: [
      "cell site location information",
      "geofence warrant",
      "search incident to arrest",
      "cell phone",
      "digital data",
    ],
    terms: ["privacy", "warrant", "fourth amendment"],
    caseNames: [],
    bills: [],
    from: null,
    to: null,
  };

  function stubFamily(): void {
    asked = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
        return Response.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(familyIntent) }] } }],
        });
      }
      if (url.includes("courtlistener.com")) {
        asked.push(url);
        return Response.json(phoneFamily);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  }

  test("all three cases a web search names come back", async () => {
    stubFamily();
    const output = await searchJudicialOpinions("scotus case about cell phone privacy", 10);
    const names = output.results.map((r) => r.case_name);

    expect(names.some((n) => n.includes("Chatrie"))).toBe(true);
    expect(names.some((n) => n.includes("Carpenter"))).toBe(true);
    expect(names.some((n) => n.includes("Riley"))).toBe(true);
  });

  test("this term's ruling is not buried by a landmark's citation count", async () => {
    // THE DEFECT THIS PINS, and it was mine. Prominence was citation count
    // alone, defended on the grounds that a 1905 opinion can be today's
    // controlling law. True, and it buries every ruling handed down this term:
    //
    //   Riley v. California   2014, 1,311 citations
    //   Carpenter v. US       2018, 1,222 citations
    //   Chatrie v. US         2026,     0 citations
    //
    // A case has no citations for exactly the reason it is news. Chatrie is
    // what a person asking this question today wants, and it finished 40 points
    // behind. Recency now earns credit on a curve that decays over three years.
    stubFamily();
    const output = await searchJudicialOpinions("scotus case about cell phone privacy", 10);
    const names = output.results.map((r) => r.case_name);

    // Chatrie now leads, ahead of Riley and Carpenter — the same three cases a
    // plain web search names, in the order it names them. Before this it sat
    // fourth, behind Birchfield v. North Dakota: a drunk-driving blood-test
    // case that matched "search incident to arrest" and has had ten years to
    // accumulate citations.
    expect(names[0]).toContain("Chatrie");
    expect(names.findIndex((n) => n.includes("Birchfield"))).toBeGreaterThan(
      names.findIndex((n) => n.includes("Chatrie")),
    );
  });

  test("naming the branch is not part of the topic", async () => {
    // "scotus case about cell phone privacy" — the first two words say WHERE to
    // look, not WHAT to look for. Left in the topic, the fallback searches
    // opinions for the word "scotus", which appears in none of them.
    const bare = plainIntent("scotus case about cell phone privacy", "judicial");
    expect(bare.topic).toBe("cell phone privacy");
    expect(bare.terms).not.toContain("scotus");
    expect(bare.terms).not.toContain("case");
  });
});

/**
 * One decision, one result.
 *
 * OBSERVED IN LIVE OUTPUT, not imagined: a search for phone privacy returned
 * Riley v. California twice — clusters 8385044 and 8391734, the same 2014
 * ruling. CourtListener stores a case more than once (a slip opinion and the
 * bound volume, a corrected reissue, a second reporter's copy), so deduping by
 * cluster id treats one case as two. To a reader it is the same ruling listed
 * twice, pushing a different case off the page.
 */
describe("the same case is never listed twice", () => {
  /** The two Riley clusters, as CourtListener actually returned them. */
  const twoCopies = {
    count: 2,
    results: [
      {
        cluster_id: 8385044,
        caseName: "Riley v. California",
        court: "Supreme Court of the United States",
        court_id: "scotus",
        dateFiled: "2014-01-17",
        // Reporter's prefix and an en dash — the same docket, written
        // differently.
        docketNumber: "No. 13–132.",
        absolute_url: "/opinion/8414700/riley-v-california/",
        citeCount: 0,
        opinions: [{ id: 8385044, snippet: "cell phone search incident to arrest" }],
      },
      {
        cluster_id: 8391734,
        caseName: "Riley v. California",
        court: "Supreme Court of the United States",
        court_id: "scotus",
        dateFiled: "2014-06-25",
        docketNumber: "13-132",
        absolute_url: "/opinion/2812209/riley-v-california/",
        citeCount: 1311,
        opinions: [{ id: 8391734, snippet: "cell phone search incident to arrest" }],
      },
    ],
  };

  function stubCopies(): void {
    asked = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generativelanguage.googleapis.com") || url.includes("api.openai.com")) {
        return new Response("upstream unavailable", { status: 503 });
      }
      if (url.includes("courtlistener.com")) {
        asked.push(url);
        return Response.json(twoCopies);
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch;
  }

  test("two clusters of one ruling collapse to one result", async () => {
    stubCopies();
    const output = await searchJudicialOpinions("cell phone privacy", 10);

    const rileys = output.results.filter((r) => r.case_name === "Riley v. California");
    expect(rileys).toHaveLength(1);
  });

  test("the better-attested copy is the one kept", async () => {
    // The bound volume carries the citations; the slip opinion carries none.
    // Which one CourtListener happens to return first is not a fact about the
    // case, and keeping the uncited copy would also cost it its prominence.
    stubCopies();
    const output = await searchJudicialOpinions("cell phone privacy", 10);

    const riley = output.results.find((r) => r.case_name === "Riley v. California");
    expect(riley!.date_filed).toBe("2014-06-25");
    expect(riley!.docket_number).toBe("13-132");
  });
});
