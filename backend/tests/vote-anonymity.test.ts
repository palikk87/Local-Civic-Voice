/**
 * ASKED ONCE, AT THE MOMENT IT MATTERS.
 *
 * Voting under your own name was the default, the only switch for it was in
 * Settings, and nothing near a vote button ever mentioned it. So somebody who
 * never opened Settings had been putting their name on public positions about
 * immigration, healthcare and guns without being told that is what they were
 * doing. The platform kept its promise; it just never made the offer.
 *
 * `voteAnonymityChosen` is the whole fix on this side: the difference between
 * "chose to be named" and "never knew there was a choice", which until now were
 * the same row. The apps ask once, on the first vote, and stop.
 *
 * These are the four things that have to hold for that to work.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

let seq = 0;
async function citizen() {
  seq += 1;
  return signUp({
    email: `anon${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `Anon ${seq}`,
  });
}

let refCounter = 0;
async function law() {
  refCounter += 1;
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: `hr-${7000 + refCounter}-119`,
      referenceType: "bill",
      title: "A law worth a position",
      status: "proposed",
      category: "healthcare",
    },
  });
}

function vote(cookie: string, referenceId: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/government-references/${referenceId}/vote`, {
    method: "POST",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(body),
  });
}

async function preferences(cookie: string) {
  const response = await fetch(`${BASE_URL}/api/notifications/preferences`, {
    headers: freshClientHeaders({ cookie }),
  });
  return (await response.json()) as {
    preferences: { voteAnonymously: boolean; voteAnonymityChosen: boolean };
  };
}

function setPreferences(cookie: string, body: Record<string, unknown>) {
  return fetch(`${BASE_URL}/api/notifications/preferences`, {
    method: "PUT",
    headers: freshClientHeaders({ "Content-Type": "application/json", cookie }),
    body: JSON.stringify(body),
  });
}

/** The record is written after the response, so give it a moment to land. */
async function position(userId: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const row = await prisma.positionEvent.findFirst({ where: { userId } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

describe("[bor-art4] asked once, before the first vote", () => {
  test("A NEW ACCOUNT HAS NOT BEEN ASKED — which is what tells the apps to ask", async () => {
    const person = await citizen();
    const { preferences: theirs } = await preferences(person.cookie);

    expect(theirs.voteAnonymityChosen).toBe(false);

    // And the default itself is unchanged: named, not anonymous. A platform
    // that quietly anonymised everybody would be making the choice for them
    // just as surely as one that never offered it.
    expect(theirs.voteAnonymously).toBe(false);
  });

  test("ANSWERING IN SETTINGS COUNTS AS ANSWERING — nobody is asked twice", async () => {
    const person = await citizen();

    await setPreferences(person.cookie, { voteAnonymously: true });

    const { preferences: theirs } = await preferences(person.cookie);
    expect(theirs.voteAnonymously).toBe(true);
    // The flag was never sent by the client. Somebody who reaches into Settings
    // and moves this switch has made the choice, and must not be stopped
    // mid-vote later to answer a question they have already answered.
    expect(theirs.voteAnonymityChosen).toBe(true);
  });

  test("changing an unrelated preference does not count as answering it", async () => {
    const person = await citizen();

    await setPreferences(person.cookie, { likes: false });

    const { preferences: theirs } = await preferences(person.cookie);
    expect(theirs.voteAnonymityChosen).toBe(false);
  });
});

describe("[bor-art4] the standing choice, and departing from it", () => {
  test("THE STANDING CHOICE IS APPLIED WITH NOTHING SENT — every surface, not just the ones with a checkbox", async () => {
    const person = await citizen();
    const record = await law();

    await setPreferences(person.cookie, { voteAnonymously: true });

    // The vote carries no anonymity flag at all, the way the feed, the
    // timeline and every card send it.
    const response = await vote(person.cookie, record.id, { position: "support" });
    expect(response.status).toBe(200);

    const written = await position(person.userId);
    expect(written?.isAnonymous).toBe(true);
  });

  test("one record can depart from it — in both directions", async () => {
    const named = await citizen();
    const quiet = await citizen();
    const one = await law();
    const two = await law();

    // Standing choice: named. This one vote goes without the name.
    await vote(named.cookie, one.id, { position: "support", anonymous: true });
    expect((await position(named.userId))?.isAnonymous).toBe(true);

    // Standing choice: anonymous. This one vote carries the name.
    await setPreferences(quiet.cookie, { voteAnonymously: true });
    await vote(quiet.cookie, two.id, { position: "oppose", anonymous: false });
    expect((await position(quiet.userId))?.isAnonymous).toBe(false);
  });

  test("THE TALLY IS BLIND TO IT — withholding a name never withholds the voice", async () => {
    const open = await citizen();
    const hidden = await citizen();
    const record = await law();

    await vote(open.cookie, record.id, { position: "support" });
    await vote(hidden.cookie, record.id, { position: "support", anonymous: true });

    const response = await fetch(`${BASE_URL}/api/government-references/${record.id}`, {
      headers: freshClientHeaders({}),
    });
    const { reference } = (await response.json()) as {
      reference: { votes: { support: number; total: number } };
    };

    // Two people backed it. An anonymous position is carried into the Pulse
    // exactly like any other; that is the entire point of offering it.
    expect(reference.votes.support).toBe(2);
    expect(reference.votes.total).toBe(2);
  });
});
