/**
 * A district court order was published here as a Supreme Court ruling.
 *
 * The Library's judicial search asked CourtListener across the whole federal
 * judiciary, and opening any result files it as a scotus_case. So "In re the
 * United States for an Order Authorizing Disclosure of Location Information",
 * docket case-no-10-2188-skg — a Maryland magistrate judge's order — was
 * published on this platform as a ruling of the Supreme Court of the United
 * States, with Aye and Nay buttons under it.
 *
 * The search is scoped now and the ingest refuses another court. This covers
 * the third part: removing what was stored before either existed, and the two
 * rules that stop the removal being its own kind of damage.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { prisma, resetData, startServer, stopServer } from "./helpers/server";
import { courtIdOf, opinionIdFromUrl, purgeNonScotusRulings } from "../src/services/scotus-only";

const realFetch = globalThis.fetch;
const realKey = process.env.COURTLISTENER_API_KEY;

/**
 * CourtListener answers with the court for each cluster id it is asked about.
 *
 * The query is asserted, not just parsed: this must go through the SEARCH
 * endpoint, which answers without a key. The first version of this asked
 * /clusters/?sub_opinions=, which returns 401 anonymously — so in production
 * every lookup failed, every record was kept, and the purge deleted nothing
 * while reporting success.
 */
function courtSays(byClusterId: Record<number, string | null>): void {
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("courtlistener.com")) return realFetch(input, init);
    if (!url.includes("/search/")) {
      throw new Error(`the purge must ask the keyless search endpoint, not: ${url}`);
    }
    const match = /cluster_id(?:%3A|:)(\d+)/.exec(url);
    if (!match) throw new Error(`no cluster_id in the query: ${url}`);
    const court = byClusterId[Number(match[1])];
    if (court === undefined) return new Response("no", { status: 503 });
    if (court === null) return Response.json({ results: [] });
    return Response.json({ results: [{ court_id: court }] });
  }) as typeof fetch;
}

const ruling = (id: string, opinionId: number, extra: Record<string, unknown> = {}) =>
  prisma.governmentReference.create({
    data: {
      id,
      masterReferenceId: id,
      referenceType: "scotus_case",
      title: `Ruling ${id}`,
      status: "decided",
      sourceUrl: `https://www.courtlistener.com/opinion/${opinionId}/ruling-${id}/`,
      ...extra,
    },
  });

beforeAll(async () => {
  await startServer();
  process.env.COURTLISTENER_API_KEY = "test-token-never-sent-anywhere";
});
beforeEach(async () => { await resetData(); });
afterEach(() => { globalThis.fetch = realFetch; });
afterAll(async () => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.COURTLISTENER_API_KEY;
  else process.env.COURTLISTENER_API_KEY = realKey;
  await stopServer();
});

describe("reading the court out of an answer", () => {
  test("the opinion id comes off a CourtListener url", () => {
    expect(opinionIdFromUrl("https://www.courtlistener.com/opinion/6461471/city-of-austin/")).toBe(6461471);
    expect(opinionIdFromUrl("https://www.supremecourt.gov/opinions/21pdf/20-1029.pdf")).toBeNull();
    expect(opinionIdFromUrl(null)).toBeNull();
    expect(opinionIdFromUrl("")).toBeNull();
  });

  test("the court is read from either shape CourtListener sends", () => {
    expect(courtIdOf({ court_id: "scotus" })).toBe("scotus");
    // The other shape: a resource URL whose last segment is the court.
    expect(courtIdOf({ court: "https://www.courtlistener.com/api/rest/v4/courts/mdd/" })).toBe("mdd");
    expect(courtIdOf({ court_id: "  SCOTUS  " })).toBe("scotus");
    expect(courtIdOf({})).toBeNull();
    expect(courtIdOf(null)).toBeNull();
  });
});

describe("purging what is not the Supreme Court", () => {
  test("IT ASKS AN ENDPOINT THAT ANSWERS WITHOUT A KEY", async () => {
    /*
     * The failure this exists for did not throw and did not log. The purge
     * asked an authenticated endpoint, got 401 on every record, read that as
     * "could not find out", kept everything, and reported success. It ran in
     * production against a real district court order and removed nothing.
     *
     * A deletion must not be able to fail quietly for want of a credential.
     */
    delete process.env.COURTLISTENER_API_KEY;
    await ruling("no-key-needed", 8713868);
    courtSays({ 8713868: "mdd" });

    const result = await purgeNonScotusRulings();
    expect(result.purged.length).toBe(1);
    expect(await prisma.governmentReference.findUnique({ where: { id: "no-key-needed" } })).toBeNull();
    process.env.COURTLISTENER_API_KEY = "test-token-never-sent-anywhere";
  });

  test("A DISTRICT COURT ORDER IS REMOVED", async () => {
    await ruling("keep-1", 111);
    await ruling("magistrate-1", 222);
    courtSays({ 111: "scotus", 222: "mdd" });

    const result = await purgeNonScotusRulings();
    expect(result.purged.length).toBe(1);
    expect(result.purged[0]).toContain("magistrate-1");

    expect(await prisma.governmentReference.findUnique({ where: { id: "keep-1" } })).not.toBeNull();
    expect(await prisma.governmentReference.findUnique({ where: { id: "magistrate-1" } })).toBeNull();
  });

  test("A RECORD SOMEBODY HAS VOTED ON AND POSTED ABOUT GOES TOO, WHOLE", async () => {
    /*
     * This test asserted the opposite an hour ago: that a record with a vote on
     * it was never deleted, because votes cascade and destroying somebody's
     * recorded position to tidy up our own mistake is the one thing this
     * platform says it never does.
     *
     * Khalid overrode that, for this and only this: "I don't care if anyone has
     * posted any posts or votes on it. this was a failure on our part so
     * allowing those to continue ... is unacceptable."
     *
     * He is right about the reasoning. A vote on a district court order that we
     * published as a Supreme Court ruling is a vote on something we invented.
     * Keeping the record to protect the vote protects the false claim instead.
     */
    const user = await prisma.user.create({
      data: { id: "purge-voter", email: "voter@example.test", name: "Voter", emailVerified: true },
    });
    await ruling("voted-on", 333, { supportVotes: 1 });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: "voted-on", userId: user.id, position: "support" },
    });
    await prisma.post.create({
      data: { authorId: user.id, content: "I shared this ruling", governmentReferenceId: "voted-on" },
    });
    await prisma.referenceName.create({
      data: { referenceId: "voted-on", name: "An older name it answered to", learnedFrom: "test" },
    });
    courtSays({ 333: "ca9" });

    const result = await purgeNonScotusRulings();

    expect(result.purged.length).toBe(1);
    expect(result.purged[0]).toContain("voted-on");
    expect(result.removed.posts).toBe(1);
    expect(result.removed.votes).toBe(1);
    expect(result.removed.names).toBe(1);

    // The record, and every trace of it.
    expect(await prisma.governmentReference.findUnique({ where: { id: "voted-on" } })).toBeNull();
    expect(await prisma.governmentReferenceVote.count({ where: { governmentReferenceId: "voted-on" } })).toBe(0);
    expect(await prisma.referenceName.count({ where: { referenceId: "voted-on" } })).toBe(0);
    // The post must not survive detached. Prisma's default for that optional
    // relation is SetNull, which would leave it on somebody's My Voice still
    // claiming they shared a Supreme Court ruling.
    expect(await prisma.post.count({ where: { authorId: user.id } })).toBe(0);
    // The person is untouched. Only what we published about them is gone.
    expect(await prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  test("a ruling merged into the purged one is left standing, not orphaned", async () => {
    // Its pointer at the deleted survivor is cleared rather than followed, so
    // the next pass judges it on its own court rather than on a dead link.
    await ruling("merge-survivor", 991);
    await ruling("merged-in", 992, { mergedIntoId: "merge-survivor" });
    courtSays({ 991: "cadc", 992: "scotus" });

    await purgeNonScotusRulings();

    expect(await prisma.governmentReference.findUnique({ where: { id: "merge-survivor" } })).toBeNull();
    const stillThere = await prisma.governmentReference.findUnique({ where: { id: "merged-in" } });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.mergedIntoId).toBeNull();
  });

  test("A SOURCE THAT WILL NOT ANSWER DELETES NOTHING", async () => {
    // The failure mode that matters: a network problem must never be able to
    // empty this table. Silence is not evidence of anything.
    await ruling("unreachable-1", 444);
    await ruling("unreachable-2", 555);
    courtSays({}); // every request 503s

    const result = await purgeNonScotusRulings();
    expect(result.purged).toEqual([]);
    expect(await prisma.governmentReference.count({ where: { referenceType: "scotus_case" } })).toBe(2);
  });

  test("an answer with no court in it deletes nothing either", async () => {
    await ruling("empty-answer", 666);
    courtSays({ 666: null });

    const result = await purgeNonScotusRulings();
    expect(result.purged).toEqual([]);
    expect(await prisma.governmentReference.findUnique({ where: { id: "empty-answer" } })).not.toBeNull();
  });

  test("a settled table is left exactly as it is", async () => {
    await ruling("settled-1", 777);
    await ruling("settled-2", 888);
    courtSays({ 777: "scotus", 888: "scotus" });

    const first = await purgeNonScotusRulings();
    const second = await purgeNonScotusRulings();
    expect(first.purged).toEqual([]);
    expect(second.purged).toEqual([]);
    expect(second.kept).toBe(2);
  });
});
