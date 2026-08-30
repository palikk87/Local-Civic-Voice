/**
 * ONE PERSON'S USE MUST NOT LOCK OUT THE PERSON NEXT TO THEM.
 *
 * FOUND BY THE LOAD CHECK, not by reading the code. Five hundred signed-in
 * citizens voting on one law from one machine produced four successful
 * sign-ins, four accepted votes, and then 429 on everything — including
 * `/health`. The natural reading was "the server fell over under load". It had
 * not: the whole run was inside one rate-limit bucket.
 *
 * WHY. `getClientIdentifier` is written to key the limit by the signed-in
 * user's id and to fall back to the IP address only for a stranger, which is
 * exactly right. But `app.use("*", generalRateLimit)` is registered BEFORE the
 * middleware that sets `c.set("user", …)`. So at the moment the limiter asks
 * who this is, nobody has answered yet — `c.get("user")` is undefined, and the
 * `user:` branch is unreachable code for every request the general limiter
 * sees. Every request in the system was keyed by IP.
 *
 * WHAT THAT COSTS A REAL PERSON. A hundred requests a minute, shared by
 * everybody behind one address: an office, a school, a library, a household, or
 * anybody on a mobile carrier doing carrier-grade NAT — which is most phones.
 * A page view is several requests. So on a civic platform, during exactly the
 * hour a bill is being voted on and colleagues are talking about it, a
 * workplace gets locked out together, and the platform blames itself for being
 * slow. It is also the cheapest possible denial of service against a
 * neighbourhood: one busy tab.
 *
 * THE FIX IS THE ORDERING. Authenticate first, limit second. An anonymous
 * request still costs almost nothing to identify — no cookie means no session
 * lookup — so limiting a flood of strangers is as cheap as it was.
 *
 * These tests pin the behaviour rather than the ordering, so a later
 * refactor that reaches the same answer another way still passes.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BASE_URL, freshClientHeaders, resetData, signUp, startServer, stopServer } from "./helpers/server";

const PASSWORD = "one-bucket-each-not-a-real-password";

/** One address, shared. This is the whole point: a household, an office, a phone network. */
const SHARED_ADDRESS = "198.51.100.7";

let alice = "";
let bob = "";

/** A cheap authenticated GET, from the shared address. */
function knock(cookie: string) {
  return fetch(`${BASE_URL}/api/notifications/unread-count`, {
    headers: { "x-forwarded-for": SHARED_ADDRESS, Cookie: cookie },
  });
}

/** The same request with nobody signed in. */
function knockAnonymously() {
  return fetch(`${BASE_URL}/health`, { headers: { "x-forwarded-for": SHARED_ADDRESS } });
}

const remainingOn = (response: Response) =>
  Number(response.headers.get("X-RateLimit-Remaining") ?? "-1");

beforeAll(async () => {
  await startServer();
  await resetData();

  // Signed up from their own addresses, because sign-up is under the stricter
  // auth limiter and that is not what is being tested here.
  const a = await signUp({ email: "alice-limit@example.com", password: PASSWORD, name: "Alice" });
  const b = await signUp({ email: "bob-limit@example.com", password: PASSWORD, name: "Bob" });
  alice = a.cookie;
  bob = b.cookie;

  // Make sure the sign-ups themselves did not spend the shared address's
  // budget — freshClientHeaders gives each of those its own address.
  freshClientHeaders();
});

afterAll(async () => {
  await stopServer();
});

describe("the rate limit follows the person, not the address", () => {
  test("two people on one connection do not share one budget", async () => {
    // Alice uses the connection hard. Well short of the limit on her own, but
    // more than half of it if the two of them are sharing.
    let last: Response | undefined;
    for (let i = 0; i < 60; i += 1) {
      last = await knock(alice);
    }

    expect(last?.status).toBe(200);
    const aliceLeft = remainingOn(last!);

    // Bob now knocks once, from the same address, for the first time.
    const bobFirst = await knock(bob);
    const bobLeft = remainingOn(bobFirst);

    expect(bobFirst.status).toBe(200);

    // THE ASSERTION. Bob has barely used the platform, so he must have most of
    // his budget. Under the bug he inherits Alice's spend and shows roughly
    // what she had left.
    //
    // Compared against Alice's remaining rather than a fixed number, so the
    // test keeps meaning what it means if the configured limit changes.
    expect(bobLeft).toBeGreaterThan(aliceLeft + 10);
  });

  test("one person exhausting their budget does not lock out the other", async () => {
    // Spend Carol all the way to 429 from the shared address.
    const carol = await signUp({
      email: "carol-limit@example.com",
      password: PASSWORD,
      name: "Carol",
    });

    let carolBlocked = false;
    for (let i = 0; i < 200 && !carolBlocked; i += 1) {
      const response = await knock(carol.cookie);
      if (response.status === 429) carolBlocked = true;
    }

    expect(carolBlocked).toBe(true);

    // Dave, on the same connection, has done nothing. He must still be served.
    const dave = await signUp({
      email: "dave-limit@example.com",
      password: PASSWORD,
      name: "Dave",
    });
    const daveKnock = await knock(dave.cookie);

    expect(daveKnock.status).toBe(200);
  });

  test("ORDINARY BROWSING DOES NOT SPEND A CONSTITUTIONAL RIGHT", async () => {
    /**
     * THE BUG THIS PINS, which was live and completely invisible.
     *
     * Every limiter shares one store, and that store was keyed by the caller's
     * identity alone — so two limiters that produced the same identity shared
     * one list of timestamps, and each then filtered that shared list by ITS
     * OWN window before counting.
     *
     * Filing Articles of System Reset is limited to one a day, on purpose: it
     * notifies every account on the platform. The general limiter writes a
     * timestamp for the same person on every ordinary request. Same key. So the
     * daily limiter read ordinary page loads as filings, and a citizen who had
     * used the site at all that day was told "One a day." — about something
     * they had never done.
     *
     * It surfaced only because the general limiter started keying by person
     * rather than by address. Before that the two keys happened not to collide,
     * which is not a design; it is a coincidence that was one change away from
     * ending. Twenty-five tests went red at once and the message said nothing
     * about rate limiting.
     */
    const eve = await signUp({
      email: "eve-limit@example.com",
      password: PASSWORD,
      name: "Eve",
    });

    // She uses the platform normally for a bit. Nowhere near any limit.
    for (let i = 0; i < 20; i += 1) {
      await knock(eve.cookie);
    }

    // And then exercises Article V. This must be her FIRST filing, not her
    // twenty-first request.
    const filed = await fetch(`${BASE_URL}/api/system-reset`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": SHARED_ADDRESS,
        Cookie: eve.cookie,
      },
      body: JSON.stringify({
        grounds: "The tallies on this platform no longer describe what anybody currently believes.",
        evidence: "Half the records carry positions taken on text that has since been amended twice.",
      }),
    });

    expect(filed.status).not.toBe(429);
  });

  test("a stranger is still limited, because there is nothing else to go on", async () => {
    // The IP fallback has to keep working. Removing the shared-address problem
    // for signed-in people must not hand an anonymous flood a free pass.
    let blocked = false;
    for (let i = 0; i < 400 && !blocked; i += 1) {
      const response = await knockAnonymously();
      if (response.status === 429) blocked = true;
    }

    expect(blocked).toBe(true);
  });
});
