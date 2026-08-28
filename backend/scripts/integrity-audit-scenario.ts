/**
 * Run the Integrity Audit through the thousand — Constitution Article III §2.
 *
 *   TEST_POPULATION_DATABASE_URL=postgresql://…/civicvoice_population \
 *     bun run scripts/integrity-audit-scenario.ts
 *
 * WHY, WHEN THERE IS ALREADY A UNIT SUITE. Those tests run against a handful of
 * accounts, and every finding here is a statement about a population: a share
 * of sign-ups, a busiest hour, a ring in a delegation graph, a recount over
 * hundreds of votes. A statistic that is right for six people and wrong for six
 * hundred is a statistic nobody should rely on, and this feature exists to be
 * relied on.
 *
 * IT PLANTS THE PATTERNS ON PURPOSE. A ring, a stack of support inside one
 * hour, and a tally corrupted by hand. An audit that has never been shown
 * catching anything is a reassurance rather than a remedy.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — it never reads DATABASE_URL. It puts
 * every row it created back on the way out and says whether it succeeded.
 */
import { PrismaClient } from "@prisma/client";
import { assertPopulationDatabase, citizen, countPopulation } from "./lib/test-population";

const url = process.env.TEST_POPULATION_DATABASE_URL;

let databaseName: string;
try {
  databaseName = assertPopulationDatabase(url);
} catch (error) {
  console.error(`\n${(error as Error).message}\n`);
  process.exit(1);
}

process.env.DATABASE_URL = url!;
process.env.DIRECT_URL = url!;
// NOT A CREDENTIAL: nothing here issues a session or decrypts a stored key, and
// the string is deliberately one that could never be a real secret. The env
// module validates on import and this process needs a value to get past it.
process.env.BETTER_AUTH_SECRET ??= "integrity-audit-scenario-not-a-real-secret";
process.env.APP_ORIGINS ??= "*";
process.env.CIVIC_NO_BACKGROUND_SYNC = "1";

const { runAudit, auditForImpeachment } = await import("../src/services/integrity-audit");
const { applyWeightedTally } = await import("../src/services/delegation-service");
const { fileImpeachment } = await import("../src/services/impeachment");
const { MIN_COHORT } = await import("../src/services/jurisdiction");

const prisma = new PrismaClient({ datasources: { db: { url } } });

const DAY = 24 * 60 * 60 * 1000;
const REF_PREFIX = "auditscenario";

/** One leader, sixty lenders, and two hundred people voting on a record. */
const LEADER = citizen(1);
const LENDERS = Array.from({ length: 60 }, (_, i) => citizen(i + 2));
const VOTERS = Array.from({ length: 200 }, (_, i) => citizen(i + 100));
/** Three who will pass a voice round in a circle. */
const RING = [citizen(700), citizen(701), citizen(702)];
/** Two on a record nobody else touches, to prove the floor holds. */
const QUIET = [citizen(800), citizen(801)];

const EVERYONE = [LEADER, ...LENDERS, ...VOTERS, ...RING, ...QUIET];
const ALL_IDS = [...new Set(EVERYONE.map((c) => c.id))];

const failures: string[] = [];
function check(label: string, condition: boolean, detail?: string) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

type Finding = { id: string; status: string; summary: string; detail: Record<string, number> };

function finding(findings: Finding[], id: string): Finding {
  const found = findings.find((f) => f.id === id);
  if (!found) throw new Error(`no finding "${id}" among ${findings.map((f) => f.id).join(", ")}`);
  return found;
}

/** The cooldown is an hour, and this scenario audits the same subject twice. */
async function ageAudits() {
  await prisma.integrityAudit.updateMany({
    data: { runAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
  });
}

async function tidy() {
  const refs = await prisma.governmentReference.findMany({
    where: { masterReferenceId: { startsWith: REF_PREFIX } },
    select: { id: true },
  });
  const refIds = refs.map((r) => r.id);

  await prisma.integrityAudit.deleteMany({});
  await prisma.impeachment.deleteMany({});
  await prisma.delegation.deleteMany({ where: { toUserId: { in: ALL_IDS } } });
  await prisma.delegation.deleteMany({ where: { fromUserId: { in: ALL_IDS } } });
  await prisma.notification.deleteMany({});
  await prisma.post.deleteMany({ where: { authorId: { in: ALL_IDS } } });
  await prisma.governmentReferenceVote.deleteMany({
    where: { governmentReferenceId: { in: refIds } },
  });
  await prisma.positionEvent.deleteMany({ where: { userId: { in: ALL_IDS } } });
  await prisma.governmentReference.deleteMany({
    where: { masterReferenceId: { startsWith: REF_PREFIX } },
  });
  await prisma.user.updateMany({ where: { id: { in: ALL_IDS } }, data: { createdAt: new Date() } });
}

console.log(`Running the Integrity Audit through the population in "${databaseName}".\n`);

try {
  await tidy();

  // ------------------------------------------------------------ the support

  // Delegate eligibility takes a fortnight to earn honestly; the date is the
  // one thing backdated. Everything else is real rows of the real kind.
  await prisma.user.update({
    where: { id: LEADER.id },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });

  await prisma.delegation.createMany({
    data: LENDERS.map((l) => ({ fromUserId: l.id, toUserId: LEADER.id })),
    skipDuplicates: true,
  });

  const support = await runAudit({
    subjectType: "leader",
    subjectId: LEADER.id,
    requestedById: null,
  });
  check("a leader's own support can be audited", support.ok);
  if (!support.ok) throw new Error("the first audit did not run");

  const growth = finding(support.audit.findings as Finding[], "delegation-growth");
  check(
    "sixty delegators are counted, every one of them",
    growth.detail.delegators === LENDERS.length,
    `${growth.detail.delegators} of ${LENDERS.length}`,
  );
  check(
    "SUPPORT THAT ARRIVED ALL AT ONCE IS SURFACED",
    growth.status === "attention" && growth.detail.largestSingleHour === LENDERS.length,
    growth.summary,
  );

  const rings = finding(support.audit.findings as Finding[], "rings");
  check("with no circle in the graph, it says so plainly", rings.status === "ok", rings.summary);

  check(
    "no name, username or email appears anywhere in the audit",
    !EVERYONE.some((person) => {
      const text = JSON.stringify(support.audit);
      return text.includes(person.username) || text.includes(person.email) || text.includes(person.name);
    }),
  );

  // ------------------------------------------------------------- a real ring

  // Voice travelling in a circle inflates nobody's tally, but a ring nobody
  // meant to build is a sign people do not know where their voice goes.
  await prisma.delegation.createMany({
    data: [
      { fromUserId: RING[0]!.id, toUserId: RING[1]!.id },
      { fromUserId: RING[1]!.id, toUserId: RING[2]!.id },
      { fromUserId: RING[2]!.id, toUserId: RING[0]!.id },
      ...LENDERS.slice(0, 10).map((l) => ({ fromUserId: l.id, toUserId: RING[0]!.id })),
    ],
    skipDuplicates: true,
  });

  await ageAudits();
  const ringed = await runAudit({
    subjectType: "leader",
    subjectId: RING[0]!.id,
    requestedById: null,
  });
  if (!ringed.ok) throw new Error("the ring audit did not run");

  const found = finding(ringed.audit.findings as Finding[], "rings");
  check(
    "A VOICE TRAVELLING IN A CIRCLE IS FOUND",
    found.status === "attention" && (found.detail.circularChains ?? 0) > 0,
    found.summary,
  );
  check("…and the circle's length is reported", found.detail.shortestChain === 3, found.summary);
  check(
    "…without publishing a route, which would be three names",
    !RING.some((person) => JSON.stringify(found).includes(person.id)),
  );

  // ------------------------------------------------- two hundred vote, and it counts

  const busy = await prisma.governmentReference.create({
    data: {
      masterReferenceId: `${REF_PREFIX}-busy`,
      referenceType: "bill",
      title: "A bill two hundred citizens voted on",
      status: "proposed",
      category: "healthcare",
    },
  });

  await prisma.governmentReferenceVote.createMany({
    data: VOTERS.map((v, i) => ({
      governmentReferenceId: busy.id,
      userId: v.id,
      position: i % 3 === 0 ? "oppose" : "support",
    })),
    skipDuplicates: true,
  });
  const published = await applyWeightedTally(busy.id);

  await ageAudits();
  const clean = await runAudit({
    subjectType: "reference",
    subjectId: busy.id,
    requestedById: null,
  });
  if (!clean.ok) throw new Error("the record audit did not run");

  const recount = finding(clean.audit.findings as Finding[], "recount");
  check(
    "the recount agrees with the published tally at two hundred votes",
    recount.status === "ok",
    `${recount.detail.publishedSupport}/${recount.detail.publishedOppose} published, ` +
      `${recount.detail.recountedSupport}/${recount.detail.recountedOppose} counted`,
  );
  check(
    "…and it counted every vote cast",
    recount.detail.votesCast === VOTERS.length,
    `${recount.detail.votesCast} of ${VOTERS.length}`,
  );

  const timing = finding(clean.audit.findings as Finding[], "timing");
  check(
    "the busiest hour is reported as a count and a share",
    timing.detail.votes === VOTERS.length && (timing.detail.largestSingleHour ?? 0) > 0,
    timing.summary,
  );

  // --------------------------------------------------- the malfunction, caught

  // Write a number nobody voted for, straight past every path that keeps the
  // tally honest. This is what Article III means by "system malfunction".
  await prisma.governmentReference.update({
    where: { id: busy.id },
    data: { supportVotes: published.support + 5_000 },
  });

  await ageAudits();
  const caught = await runAudit({
    subjectType: "reference",
    subjectId: busy.id,
    requestedById: null,
  });
  if (!caught.ok) throw new Error("the second record audit did not run");

  const mismatch = finding(caught.audit.findings as Finding[], "recount");
  check(
    "A TALLY THAT IS NOT WHAT THE VOTES ADD UP TO IS CAUGHT",
    mismatch.status === "attention",
    mismatch.summary,
  );
  check(
    "…and both numbers are published so a reader can see the gap",
    mismatch.detail.publishedSupport === published.support + 5_000 &&
      mismatch.detail.recountedSupport === published.support,
    `${mismatch.detail.publishedSupport} published, ${mismatch.detail.recountedSupport} counted`,
  );
  check("…and the audit as a whole is flagged", caught.audit.flagged);

  await applyWeightedTally(busy.id);
  const repaired = await prisma.governmentReference.findUnique({
    where: { id: busy.id },
    select: { supportVotes: true },
  });
  check(
    "…and a normal recompute puts the published number back",
    repaired?.supportVotes === published.support,
    `${repaired?.supportVotes} of ${published.support}`,
  );

  // ------------------------------------------------------------- the floor

  const quiet = await prisma.governmentReference.create({
    data: {
      masterReferenceId: `${REF_PREFIX}-quiet`,
      referenceType: "bill",
      title: "A bill two citizens voted on",
      status: "proposed",
      category: "healthcare",
    },
  });
  await prisma.governmentReferenceVote.createMany({
    data: QUIET.map((q) => ({ governmentReferenceId: quiet.id, userId: q.id, position: "support" })),
    skipDuplicates: true,
  });
  await applyWeightedTally(quiet.id);

  await ageAudits();
  const small = await runAudit({
    subjectType: "reference",
    subjectId: quiet.id,
    requestedById: null,
  });
  if (!small.ok) throw new Error("the small-record audit did not run");

  const withheld = finding(small.audit.findings as Finding[], "account-age");
  check(
    `UNDER ${MIN_COHORT} PEOPLE IT WITHHOLDS RATHER THAN PUBLISHING A SMALL NUMBER`,
    withheld.status === "withheld",
    withheld.summary,
  );
  check(
    "…and withholds the numbers with it, not just the sentence",
    Object.keys(withheld.detail).length === 0,
    JSON.stringify(withheld.detail),
  );
  check(
    "…while the recount still runs, because a tally is already public",
    finding(small.audit.findings as Finding[], "recount").status === "ok",
  );

  // ----------------------------------------- nobody defends themselves blind

  const filed = await fileImpeachment({
    leaderId: LEADER.id,
    filedById: LENDERS[0]!.id,
    grounds:
      "This delegate voted directly against the position they published and asked sixty of us " +
      "to lend them our votes for, on the record, twice in one week.",
    evidence:
      "Their posts of the third and the ninth, and the two roll-call positions recorded " +
      "against their account on the same bills, which contradict both posts.",
  });
  check("a delegator files Articles of Impeachment", filed.ok);
  if (!filed.ok) throw new Error(filed.message);

  const served = await auditForImpeachment(filed.impeachmentId);
  check("AN AUDIT RAN THE MOMENT THE ARTICLES WERE FILED", served !== null);
  check("…and it is marked as the platform's own, not a citizen's request", served?.automatic === true);
  check(
    "…and it is an audit of the support in question",
    served?.subjectType === "leader" && served?.subjectId === LEADER.id,
  );
  check(
    "…taken then, past the cooldown, rather than reusing an older one",
    served !== null && Date.now() - new Date(served.runAt).getTime() < 60_000,
  );

  const auditsKept = await prisma.integrityAudit.count();
  check("every audit run is kept, none replaced", auditsKept >= 6, `${auditsKept} on record`);

  const everything = JSON.stringify(
    await prisma.integrityAudit.findMany({ select: { findings: true } }),
  );
  check(
    "NOT ONE OF THEM CONTAINS A NAME, A USERNAME OR AN EMAIL",
    !EVERYONE.some(
      (p) =>
        everything.includes(p.username) || everything.includes(p.email) || everything.includes(p.name),
    ),
  );
} finally {
  try {
    await tidy();
    const [audits, delegations, refs, citizens] = await Promise.all([
      prisma.integrityAudit.count(),
      prisma.delegation.count(),
      prisma.governmentReference.count({
        where: { masterReferenceId: { startsWith: REF_PREFIX } },
      }),
      countPopulation(prisma),
    ]);
    const state = JSON.stringify({ audits, delegations, refs, citizens });
    check("the population is put back — all thousand present", citizens >= 1000, state);
    check("…no audits left", audits === 0, state);
    check("…no delegations left", delegations === 0, state);
    check("…and nothing this script created left", refs === 0, state);
  } catch (error) {
    console.error(`Could not put the population back: ${(error as Error).message}`);
    failures.push("population restored");
  }
  await prisma.$disconnect();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nThe Integrity Audit holds at a thousand, and names nobody.");
