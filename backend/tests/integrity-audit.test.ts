/**
 * THE RIGHT TO AUDIT — Constitution Article III §2, held to its own words.
 *
 * "Any user or group of users may demand an Integrity Audit of a specific vote
 * if there is evidence of bot interference or system malfunction."
 *
 * The clause claimed "enforced in code" would be a lie without this file, and
 * tests/constitution-enforced.test.ts fails the build if the tag below is not
 * here. So this suite is the clause.
 *
 * What is under test:
 *   - An audit counts and NEVER names. Nothing in the service selects a name,
 *     a username or an email, and nothing in a response contains one.
 *   - One gate, not a habit. Every finding is built by report() and by nothing
 *     else, so a check cannot leak a small cohort by forgetting a threshold.
 *   - Below MIN_COHORT it withholds, and withholds the numbers with it.
 *   - The recount catches a published tally that is not what the votes add up
 *     to — by actually corrupting one and running the audit against it.
 *   - Reading is public; demanding one needs an account.
 *   - Filing Articles of Impeachment runs an audit and attaches it, so nobody
 *     defends themselves blind.
 *
 * Nothing here is mocked.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_URL,
  prisma,
  resetData,
  freshClientHeaders,
  signUp,
  startServer,
  stopServer,
} from "./helpers/server";
import { MIN_COHORT } from "../src/services/jurisdiction";
import { runAudit, type Finding } from "../src/services/integrity-audit";

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
function freshReferenceId(): string {
  seq += 1;
  return `hr-${4000 + seq}-119`;
}

let people = 0;
async function citizen(label = "voter") {
  people += 1;
  return signUp({
    email: `${label}-audit-${people}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${people}`,
  });
}

async function reference() {
  return prisma.governmentReference.create({
    data: {
      masterReferenceId: freshReferenceId(),
      referenceType: "bill",
      title: "A bill somebody wants audited",
      status: "proposed",
      category: "healthcare",
    },
  });
}

function findingsOf(audit: { findings: Finding[] }, id: string): Finding {
  const found = audit.findings.find((f) => f.id === id);
  if (!found) throw new Error(`no finding "${id}" in ${audit.findings.map((f) => f.id).join(", ")}`);
  return found;
}

const SERVICE = readFileSync(join(import.meta.dir, "../src/services/integrity-audit.ts"), "utf8");

// ---------------------------------------------------------------------------

describe("[art3-sec2] an audit counts, and never names", () => {
  test("THE SERVICE NEVER SELECTS A NAME, A USERNAME OR AN EMAIL", () => {
    // The queries are the whole exposure. A select that pulls a name makes it
    // one careless interpolation away from being published, so the rule is
    // enforced at the query rather than at the response.
    const selectsIdentity = SERVICE.split("\n")
      .map((line, index) => ({ line, number: index + 1 }))
      // Comment lines describe the rule; they are not queries.
      .filter(({ line }) => !/^\s*[*/]/.test(line))
      .filter(({ line }) => /\b(name|username|displayUsername|email|image|bio)\s*:\s*true/.test(line));

    expect(selectsIdentity.map((l) => `${l.number}: ${l.line.trim()}`)).toEqual([]);
  });

  test("ONE GATE — only report() decides what a finding says", () => {
    // Two occurrences, both inside report(): the withheld branch and the live
    // one. A check that built its own finding would add a third, and a check
    // that built its own finding is a check that can forget the floor.
    const occurrences = SERVICE.split("\n").filter((line) =>
      /^\s*status: (draft\.|")/.test(line),
    );
    expect(occurrences.length).toBe(2);

    const gateEnds = SERVICE.indexOf("// Small shared arithmetic");
    for (const line of occurrences) {
      expect(SERVICE.indexOf(line)).toBeLessThan(gateEnds);
    }
  });

  test("no finding on a real audit contains a name, a username or an email", async () => {
    const leader = await citizen("leader");
    const delegators = [];
    for (let i = 0; i < MIN_COHORT + 1; i += 1) delegators.push(await citizen("lender"));

    await prisma.delegation.createMany({
      data: delegators.map((d) => ({ fromUserId: d.userId, toUserId: leader.userId })),
    });

    const result = await runAudit({
      subjectType: "leader",
      subjectId: leader.userId,
      requestedById: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialised = JSON.stringify(result.audit);
    for (const person of [leader, ...delegators]) {
      const account = await prisma.user.findUnique({
        where: { id: person.userId },
        select: { name: true, email: true, username: true },
      });
      expect(serialised).not.toContain(account!.email);
      expect(serialised).not.toContain(account!.name);
      if (account!.username) expect(serialised).not.toContain(account!.username);
    }
  });
});

describe("[art3-sec2] the privacy floor", () => {
  test(`under ${MIN_COHORT} people it withholds, and withholds the numbers too`, async () => {
    const leader = await citizen("small-leader");
    const few = [];
    for (let i = 0; i < MIN_COHORT - 2; i += 1) few.push(await citizen("few"));

    await prisma.delegation.createMany({
      data: few.map((d) => ({ fromUserId: d.userId, toUserId: leader.userId })),
    });

    const result = await runAudit({
      subjectType: "leader",
      subjectId: leader.userId,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    const age = findingsOf(result.audit, "account-age");
    expect(age.status).toBe("withheld");
    // Not a rounded count, not a share, nothing. A suppressed cell that still
    // leaks its magnitude is not suppressed.
    expect(age.detail).toEqual({});
    expect(age.summary).toContain(String(MIN_COHORT));
  });

  test(`at ${MIN_COHORT} people and above it reports`, async () => {
    const leader = await citizen("big-leader");
    const enough = [];
    for (let i = 0; i < MIN_COHORT; i += 1) enough.push(await citizen("enough"));

    await prisma.delegation.createMany({
      data: enough.map((d) => ({ fromUserId: d.userId, toUserId: leader.userId })),
    });

    const result = await runAudit({
      subjectType: "leader",
      subjectId: leader.userId,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    const age = findingsOf(result.audit, "account-age");
    expect(age.status).not.toBe("withheld");
    expect(age.detail.people).toBe(MIN_COHORT);
  });
});

describe("[art3-sec2][bor-art3] the recount", () => {
  test("a published tally that matches the votes passes", async () => {
    const ref = await reference();
    const voters = [];
    for (let i = 0; i < MIN_COHORT + 1; i += 1) voters.push(await citizen("caster"));

    for (const voter of voters) {
      const response = await fetch(`${BASE_URL}/api/government-references/${ref.id}/vote`, {
        method: "POST",
        headers: freshClientHeaders({ "Content-Type": "application/json", cookie: voter.cookie }),
        body: JSON.stringify({ position: "support" }),
      });
      expect(response.status).toBe(200);
    }

    const result = await runAudit({
      subjectType: "reference",
      subjectId: ref.id,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    const recount = findingsOf(result.audit, "recount");
    expect(recount.status).toBe("ok");
    expect(recount.detail.publishedSupport).toBe(recount.detail.recountedSupport);
    expect(recount.detail.votesCast).toBe(voters.length);

    // The audit as a whole IS flagged, and correctly: every account in a test
    // run is minutes old, which is exactly the pattern "how old the accounts
    // are" exists to surface. What matters is that the arithmetic is not the
    // reason — an audit points at a shape, it does not accuse.
    expect(result.audit.findings.filter((f) => f.status === "attention").map((f) => f.id)).toEqual([
      "account-age",
    ]);
  });

  test("A TALLY THAT IS NOT WHAT THE VOTES ADD UP TO IS CAUGHT", async () => {
    const ref = await reference();
    const voters = [];
    for (let i = 0; i < MIN_COHORT + 1; i += 1) voters.push(await citizen("honest"));

    for (const voter of voters) {
      await fetch(`${BASE_URL}/api/government-references/${ref.id}/vote`, {
        method: "POST",
        headers: freshClientHeaders({ "Content-Type": "application/json", cookie: voter.cookie }),
        body: JSON.stringify({ position: "support" }),
      });
    }

    // Write a number nobody voted for, straight past every code path that keeps
    // the tally honest. This is the malfunction Article III names, produced on
    // purpose so the remedy can be seen catching it.
    await prisma.governmentReference.update({
      where: { id: ref.id },
      data: { supportVotes: 9999 },
    });

    const result = await runAudit({
      subjectType: "reference",
      subjectId: ref.id,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    const recount = findingsOf(result.audit, "recount");
    expect(recount.status).toBe("attention");
    expect(recount.detail.publishedSupport).toBe(9999);
    expect(recount.detail.recountedSupport).toBe(voters.length);
    expect(result.audit.flagged).toBe(true);
  });

  test("the recount runs on a record too small to report anything else about", async () => {
    // The one documented exception to the floor. A record's tally is printed on
    // its own card, so withholding it inside an audit would be theatre — and it
    // is exactly on a quiet record that a wrong number would sit longest.
    const ref = await reference();
    const one = await citizen("lonely");
    await fetch(`${BASE_URL}/api/government-references/${ref.id}/vote`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: one.cookie }),
      body: JSON.stringify({ position: "oppose" }),
    });

    const result = await runAudit({
      subjectType: "reference",
      subjectId: ref.id,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    expect(findingsOf(result.audit, "recount").status).toBe("ok");
    // Everything about the PEOPLE is still withheld.
    expect(findingsOf(result.audit, "account-age").status).toBe("withheld");
  });
});

describe("[art3-sec2] delegation patterns", () => {
  test("voice travelling in a circle is reported, without a route", async () => {
    const a = await citizen("ring-a");
    const b = await citizen("ring-b");
    const c = await citizen("ring-c");
    const others = [];
    for (let i = 0; i < MIN_COHORT; i += 1) others.push(await citizen("ring-other"));

    // a → b → c → a, plus enough ordinary delegators to clear the floor.
    await prisma.delegation.createMany({
      data: [
        { fromUserId: a.userId, toUserId: b.userId },
        { fromUserId: b.userId, toUserId: c.userId },
        { fromUserId: c.userId, toUserId: a.userId },
        ...others.map((o) => ({ fromUserId: o.userId, toUserId: a.userId })),
      ],
    });

    const result = await runAudit({
      subjectType: "leader",
      subjectId: a.userId,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    const rings = findingsOf(result.audit, "rings");
    expect(rings.status).toBe("attention");
    expect(rings.detail.circularChains).toBeGreaterThan(0);
    expect(rings.detail.shortestChain).toBe(3);
    // A route is three names. The count is not.
    expect(JSON.stringify(rings)).not.toContain(a.userId);
  });

  test("support that all arrived inside one hour is surfaced to the leader", async () => {
    const leader = await citizen("stacked");
    const lenders = [];
    for (let i = 0; i < 12; i += 1) lenders.push(await citizen("lender"));

    await prisma.delegation.createMany({
      data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: leader.userId })),
    });

    const result = await runAudit({
      subjectType: "leader",
      subjectId: leader.userId,
      requestedById: null,
    });
    if (!result.ok) throw new Error("audit did not run");

    const growth = findingsOf(result.audit, "delegation-growth");
    expect(growth.status).toBe("attention");
    expect(growth.detail.delegators).toBe(12);
    expect(growth.detail.largestSingleHour).toBe(12);
  });
});

describe("[art3-sec2] demanding one", () => {
  test("READING AN AUDIT NEEDS NO ACCOUNT — a remedy only staff can read is not a remedy", async () => {
    const leader = await citizen("public-leader");
    const lenders = [];
    for (let i = 0; i < MIN_COHORT; i += 1) lenders.push(await citizen("public-lender"));
    await prisma.delegation.createMany({
      data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: leader.userId })),
    });

    const ran = await runAudit({
      subjectType: "leader",
      subjectId: leader.userId,
      requestedById: null,
    });
    if (!ran.ok) throw new Error("audit did not run");

    const signedOut = await fetch(`${BASE_URL}/api/audits/${ran.audit.id}`, {
      headers: freshClientHeaders(),
    });
    expect(signedOut.status).toBe(200);
    const body = (await signedOut.json()) as { audit: { id: string; findings: Finding[] } };
    expect(body.audit.id).toBe(ran.audit.id);
    expect(body.audit.findings.length).toBeGreaterThan(0);
  });

  test("demanding one needs an account", async () => {
    const ref = await reference();
    const response = await fetch(`${BASE_URL}/api/audits`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ subjectType: "reference", subjectId: ref.id }),
    });
    expect(response.status).toBe(401);
  });

  test("a citizen demands one and gets it — no approval, no queue", async () => {
    const ref = await reference();
    const asker = await citizen("asker");

    const response = await fetch(`${BASE_URL}/api/audits`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: asker.cookie }),
      body: JSON.stringify({ subjectType: "reference", subjectId: ref.id }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { audit: { id: string }; reused: boolean };
    expect(body.reused).toBe(false);

    // A second demand inside the hour is handed the same audit rather than
    // recomputing a delegation graph on request.
    const again = await fetch(`${BASE_URL}/api/audits`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: asker.cookie }),
      body: JSON.stringify({ subjectType: "reference", subjectId: ref.id }),
    });
    expect(again.status).toBe(200);
    const repeat = (await again.json()) as { audit: { id: string }; reused: boolean };
    expect(repeat.reused).toBe(true);
    expect(repeat.audit.id).toBe(body.audit.id);
  });

  test("the history is public, newest first, and keeps the bad months beside the good", async () => {
    const ref = await reference();
    const asker = await citizen("historian");

    await fetch(`${BASE_URL}/api/audits`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: asker.cookie }),
      body: JSON.stringify({ subjectType: "reference", subjectId: ref.id }),
    });

    const response = await fetch(
      `${BASE_URL}/api/audits/subject/reference/${ref.id}`,
      { headers: freshClientHeaders() },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { audits: Array<{ subjectId: string }> };
    expect(body.audits.length).toBe(1);
    expect(body.audits[0]!.subjectId).toBe(ref.id);
  });

  test("there is nothing to audit, and it says so rather than inventing findings", async () => {
    const asker = await citizen("hopeful");
    const response = await fetch(`${BASE_URL}/api/audits`, {
      method: "POST",
      headers: freshClientHeaders({ "Content-Type": "application/json", cookie: asker.cookie }),
      body: JSON.stringify({ subjectType: "reference", subjectId: "does-not-exist" }),
    });
    expect(response.status).toBe(404);
  });

  test("the floor is published, so no screen invents its own", async () => {
    const response = await fetch(`${BASE_URL}/api/audits/rules`, { headers: freshClientHeaders() });
    const body = (await response.json()) as { privacyFloor: number; subjectTypes: string[] };
    expect(body.privacyFloor).toBe(MIN_COHORT);
    expect(body.subjectTypes).toContain("leader");
  });
});

describe("[art3-sec2][art5-sec1] nobody defends themselves blind", () => {
  test("FILING ARTICLES RUNS AN AUDIT, AND THE PROCEEDING CARRIES IT", async () => {
    const leader = await citizen("accused");
    const electors = [];
    for (let i = 0; i < MIN_COHORT + 1; i += 1) electors.push(await citizen("elector"));

    await prisma.delegation.createMany({
      data: electors.map((e) => ({ fromUserId: e.userId, toUserId: leader.userId })),
    });

    const filed = await fetch(`${BASE_URL}/api/impeachments`, {
      method: "POST",
      headers: freshClientHeaders({
        "Content-Type": "application/json",
        cookie: electors[0]!.cookie,
      }),
      body: JSON.stringify({
        leaderId: leader.userId,
        grounds:
          "They stated on the record that this bill removes a protection it plainly keeps.",
        evidence:
          "The text of the section they cited says the opposite of what they told their delegators.",
      }),
    });
    expect(filed.status).toBe(201);

    const view = await fetch(`${BASE_URL}/api/impeachments/leader/${leader.userId}`, {
      headers: freshClientHeaders(),
    });
    const body = (await view.json()) as {
      proceeding: { audit: { subjectType: string; findings: Finding[]; automatic: boolean } | null };
    };

    expect(body.proceeding.audit).not.toBeNull();
    expect(body.proceeding.audit!.subjectType).toBe("leader");
    expect(body.proceeding.audit!.automatic).toBe(true);
    expect(body.proceeding.audit!.findings.length).toBeGreaterThan(0);
    // It arrives with the articles, so everybody votes on the same numbers.
    expect(body.proceeding.audit!.findings.map((f) => f.id)).toContain("delegation-growth");
  });
});
