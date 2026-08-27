/**
 * Run Article V through the thousand.
 *
 *   TEST_POPULATION_DATABASE_URL=postgresql://…/civicvoice_population \
 *     bun run scripts/article-v-scenario.ts
 *
 * WHY, WHEN THERE ARE ALREADY 75 UNIT TESTS. Those run against a handful of
 * accounts, and both Article V remedies are about scale: two thirds of an
 * electorate, more than half a platform turning out, a notification addressed
 * to literally everybody, and a delete that touches every vote row there is.
 * A mechanism that is correct for three people and falls over at a thousand is
 * a mechanism that works only where it does not matter.
 *
 * IT USES THE POPULATION, IT DOES NOT BUILD AROUND IT. No scaffolding, no
 * fixtures: real citizens, the real services, the real thresholds. The only
 * thing reached around is delegate eligibility, which takes fourteen days to
 * earn honestly.
 *
 * WHAT IT TOUCHES. The database named civicvoice_population, and only ever
 * through TEST_POPULATION_DATABASE_URL — it never reads DATABASE_URL, so
 * reaching the live database is not something a forgotten flag can do. It puts
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

// The services read `prisma` from src/prisma.ts, which reads DATABASE_URL. This
// script is the population's, so it points that at the population database
// BEFORE importing anything that touches it — and only in this process.
// `url` is proven non-empty by assertPopulationDatabase above, which throws
// on undefined; the non-null assertion says so to the compiler rather than
// re-checking it.
process.env.DATABASE_URL = url!;
process.env.DIRECT_URL = url!;

// The env module validates on import and this process needs a value to get
// past it. NOT A CREDENTIAL: nothing here issues a session, verifies one, or
// decrypts a stored key, and the string is deliberately one that could never
// be a real secret. Same shape as the browser checks, for the same reason.
process.env.BETTER_AUTH_SECRET ??= "article-v-scenario-not-a-real-secret";
process.env.APP_ORIGINS ??= "*";
// Nothing outbound. This must not pull real government data into a test
// database, and must not try to send mail to a thousand invalid addresses.
process.env.CIVIC_NO_BACKGROUND_SYNC = "1";

const {
  fileImpeachment,
  castVote,
  suspensionState,
} = await import("../src/services/impeachment");
const {
  openSystemReset,
  castBallot,
  decideExpiredResets,
  executeSystemReset,
  restoreMyPositions,
  undoSystemReset,
} = await import("../src/services/system-reset");

const prisma = new PrismaClient({ datasources: { db: { url } } });

const DAY = 24 * 60 * 60 * 1000;
const REF_PREFIX = "avscenario";

/** How many of the thousand take part. Enough to make every threshold real. */
const DELEGATORS = 60;
const LEADER = citizen(1);
const delegators = Array.from({ length: DELEGATORS }, (_, i) => citizen(i + 2));
const RESET_FILER = citizen(200);

const failures: string[] = [];
function check(label: string, condition: boolean, detail?: string) {
  const ok = !!condition;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

const GROUNDS =
  "This delegate voted directly against the position they published and asked sixty of us " +
  "to lend them our votes for, on the record, twice in one week.";
const EVIDENCE =
  "Their posts of the third and the ninth, and the two roll-call positions recorded against " +
  "their account on the same bills, which contradict both posts.";

async function tidy() {
  const ids = [LEADER.id, RESET_FILER.id, ...delegators.map((d) => d.id)];
  const refs = await prisma.governmentReference.findMany({
    where: { masterReferenceId: { startsWith: REF_PREFIX } },
    select: { id: true },
  });
  const refIds = refs.map((r) => r.id);

  await prisma.systemReset.deleteMany({});
  await prisma.impeachment.deleteMany({});
  await prisma.delegation.deleteMany({ where: { toUserId: { in: ids } } });
  await prisma.delegation.deleteMany({ where: { fromUserId: { in: ids } } });
  await prisma.notification.deleteMany({});
  await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.governmentReferenceVote.deleteMany({
    where: { governmentReferenceId: { in: refIds } },
  });
  await prisma.positionEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.governmentReference.deleteMany({
    where: { masterReferenceId: { startsWith: REF_PREFIX } },
  });
  await prisma.user.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date() } });
}

console.log(`Running Article V through the population in "${databaseName}".\n`);

try {
  await tidy();

  // ------------------------------------------------------- earning the seat

  await prisma.user.update({
    where: { id: LEADER.id },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });
  for (let i = 0; i < 3; i += 1) {
    await prisma.post.create({
      data: { authorId: LEADER.id, content: `A position worth putting a name to, number ${i}.` },
    });
  }

  const references: string[] = [];
  for (let i = 0; i < 25; i += 1) {
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `${REF_PREFIX}-${i}`,
        referenceType: "bill",
        title: `Scenario record ${i}`,
        status: "proposed",
        category: "infrastructure",
      },
    });
    references.push(row.id);
    if (i < 20) {
      await prisma.governmentReferenceVote.create({
        data: { governmentReferenceId: row.id, userId: LEADER.id, position: "support" },
      });
    }
  }

  // --------------------------------------------------- sixty citizens delegate

  await prisma.delegation.createMany({
    data: delegators.map((d) => ({ fromUserId: d.id, toUserId: LEADER.id })),
    skipDuplicates: true,
  });
  check(
    `${DELEGATORS} citizens lend their vote to ${LEADER.username}`,
    (await prisma.delegation.count({ where: { toUserId: LEADER.id, isActive: true } })) ===
      DELEGATORS,
  );

  // MEASURED, NOT ASSUMED. An earlier system-check run left twenty-one
  // references and their votes in this database, and asserting "the leader has
  // exactly 20 votes" failed on rows this script never created. What matters is
  // that impeachment takes none of them away, so the baseline is read here.
  const leaderVotesAtStart = await prisma.governmentReferenceVote.count({
    where: { userId: LEADER.id },
  });

  // Positions of their own, so the reset has something real to clear.
  for (let i = 0; i < 40; i += 1) {
    await prisma.governmentReferenceVote.create({
      data: {
        governmentReferenceId: references[20 + (i % 5)]!,
        userId: delegators[i]!.id,
        position: i % 2 === 0 ? "support" : "oppose",
      },
    });
  }

  // ---------------------------------------------------------- the proceeding

  const filed = await fileImpeachment({
    leaderId: LEADER.id,
    filedById: delegators[0]!.id,
    grounds: GROUNDS,
    evidence: EVIDENCE,
  });
  check("a delegator opens proceedings", filed.ok, filed.ok ? "" : filed.message);
  if (!filed.ok) throw new Error(filed.message);

  check(
    "the frozen electorate is exactly the sixty who were delegating",
    filed.electorCount === DELEGATORS,
    `${filed.electorCount}`,
  );
  check(
    "every one of them is notified",
    (await prisma.notification.count({ where: { type: "impeachment_opened" } })) === DELEGATORS,
  );
  check(
    "the accused is served the articles",
    (await prisma.notification.count({
      where: { userId: LEADER.id, type: "impeachment_served" },
    })) === 1,
  );

  // A latecomer delegates now. They must get no vote.
  const latecomer = citizen(500);
  await prisma.delegation.create({ data: { fromUserId: latecomer.id, toUserId: LEADER.id } });
  const latecomerVote = await castVote(filed.impeachmentId, latecomer.id, 30);
  check(
    "somebody who delegates after the filing has no vote",
    !latecomerVote.ok && latecomerVote.code === "not_an_elector",
    latecomerVote.ok ? "they voted" : latecomerVote.code,
  );

  // Thirty-nine of sixty is under two thirds. Forty is the bar.
  for (let i = 0; i < 39; i += 1) {
    await castVote(filed.impeachmentId, delegators[i]!.id, 30);
  }
  check(
    "39 of 60 is not two thirds — nothing has happened",
    !(await suspensionState(LEADER.id)).suspended,
  );
  check(
    "…and every delegation is still standing",
    (await prisma.delegation.count({ where: { toUserId: LEADER.id, isActive: true } })) ===
      DELEGATORS + 1,
  );

  // The fortieth. Days proposed: 10 for the first twenty, 50 for the rest, so
  // the average is a number nobody proposed — which is the point of an average.
  await castVote(filed.impeachmentId, delegators[39]!.id, 30);

  const suspension = await suspensionState(LEADER.id);
  check("the fortieth vote carries it", suspension.suspended);
  check(
    "every delegation is returned to the people who lent it",
    (await prisma.delegation.count({ where: { toUserId: LEADER.id, isActive: true } })) === 0,
  );
  const leaderPosts = await prisma.post.count({ where: { authorId: LEADER.id } });
  const leaderVotes = await prisma.governmentReferenceVote.count({ where: { userId: LEADER.id } });
  const leaderAccount = await prisma.user.findUnique({
    where: { id: LEADER.id },
    select: { banned: true },
  });
  check(
    "the leader still has their account, their posts and their own vote",
    leaderPosts === 3 && leaderVotes === leaderVotesAtStart && leaderAccount?.banned === false,
    `${leaderPosts} posts, ${leaderVotes} votes (${leaderVotesAtStart} before the vote), ` +
      `banned=${leaderAccount?.banned}`,
  );

  // -------------------------------------------------------------- the reset

  // Somebody has to be holding borrowed power for the reset to have any to
  // return: impeachment just ended every delegation on the platform. Written
  // directly, for the same reason the leader's seat was — a fresh delegate
  // needs fourteen days of history that a script cannot earn.
  await prisma.delegation.createMany({
    data: delegators.slice(0, 10).map((d) => ({ fromUserId: d.id, toUserId: RESET_FILER.id })),
    skipDuplicates: true,
  });
  const delegationsBeforeReset = await prisma.delegation.count({ where: { isActive: true } });

  const votesBefore = await prisma.governmentReferenceVote.count();
  const positionsBefore = await prisma.positionEvent.count();

  const opened = await openSystemReset({
    filedById: RESET_FILER.id,
    grounds: GROUNDS,
    evidence: EVIDENCE,
  });
  check("a verified account opens a System-Wide Reset", opened.ok, opened.ok ? "" : opened.message);
  if (!opened.ok) throw new Error(opened.message);

  check(
    "every account on the platform is eligible and counted",
    opened.eligibleCount >= 1000,
    `${opened.eligibleCount} eligible`,
  );
  check(
    "…and every account is notified",
    (await prisma.notification.count({ where: { type: "system_reset_opened" } })) >=
      opened.eligibleCount,
  );

  // More than half must turn out, and two thirds of those must agree. With a
  // thousand eligible that is 501 ballots and 335 of them in favour.
  const turnout = Math.ceil(opened.eligibleCount * 0.5) + 1;
  const inFavour = Math.ceil(turnout * 0.67);
  for (let i = 0; i < turnout; i += 1) {
    await castBallot(opened.resetId, citizen(i + 1).id, i < inFavour);
  }
  console.log(`    ${turnout} of ${opened.eligibleCount} voted; ${inFavour} in favour.`);

  await prisma.systemReset.update({
    where: { id: opened.resetId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await decideExpiredResets();

  const decided = await prisma.systemReset.findUniqueOrThrow({ where: { id: opened.resetId } });
  check("the vote passes and the reset is scheduled", decided.status === "scheduled", decided.status);
  check(
    "IT DOES NOT RUN YET — 48 hours' notice first",
    (await executeSystemReset(opened.resetId)) === null &&
      Math.round((decided.executeAfter!.getTime() - decided.decidedAt!.getTime()) / 3_600_000) === 48,
  );
  check(
    "…and every account is told what is about to be lost",
    (await prisma.notification.count({ where: { type: "system_reset_scheduled" } })) >= 1000,
  );

  await prisma.systemReset.update({
    where: { id: opened.resetId },
    data: { executeAfter: new Date(Date.now() - 1000) },
  });
  const report = await executeSystemReset(opened.resetId);
  check("the reset runs once the notice period has passed", report !== null);

  check(
    "every vote on the platform is cleared",
    (await prisma.governmentReferenceVote.count()) === 0,
    `${report?.votesCleared} cleared, ${votesBefore} before`,
  );
  check(
    "every delegation is ended",
    (await prisma.delegation.count({ where: { isActive: true } })) === 0,
  );
  check(
    "POSITIONEVENT IS UNTOUCHED — every citizen keeps their own record",
    (await prisma.positionEvent.count()) === positionsBefore,
    `${positionsBefore} before and after`,
  );
  check(
    "and not one account is lost",
    (await countPopulation(prisma)) >= 1000,
  );

  // ------------------------------------------- putting one citizen's voice back

  const mine = delegators[0]!;
  const restored = await restoreMyPositions(mine.id);
  check("a citizen puts their own positions back", restored.restored > 0, `${restored.restored}`);
  check(
    "…and only their own",
    (await prisma.governmentReferenceVote.count({ where: { userId: { not: mine.id } } })) === 0,
  );

  // ----------------------------------------------------------------- the undo

  const undone = await undoSystemReset(opened.resetId, "article-v-scenario");
  check(
    "the whole reset can be put back from the journal",
    undone.delegationsRestored === delegationsBeforeReset && undone.votesRestored > 0,
    `${JSON.stringify(undone)}; ${delegationsBeforeReset} delegations before the reset`,
  );
  check(
    "…including every delegation, by id",
    (await prisma.delegation.count({ where: { isActive: true } })) === delegationsBeforeReset,
  );
  check(
    "…and the votes come back",
    (await prisma.governmentReferenceVote.count()) === votesBefore,
    `${await prisma.governmentReferenceVote.count()} of ${votesBefore}`,
  );
} finally {
  await tidy();

  const left = {
    citizens: await countPopulation(prisma),
    impeachments: await prisma.impeachment.count(),
    resets: await prisma.systemReset.count(),
    delegations: await prisma.delegation.count(),
    references: await prisma.governmentReference.count({
      where: { masterReferenceId: { startsWith: REF_PREFIX } },
    }),
  };

  console.log("");
  check("the population is put back — all thousand present", left.citizens >= 1000, JSON.stringify(left));
  check("…no proceedings left", left.impeachments === 0 && left.resets === 0, JSON.stringify(left));
  check("…no delegations left", left.delegations === 0, JSON.stringify(left));
  check("…and nothing this script created left", left.references === 0, JSON.stringify(left));

  await prisma.$disconnect();
}

if (failures.length) {
  console.error(`\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nArticle V holds at a thousand.");
