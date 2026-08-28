/**
 * THE JUDICIARY — Constitution Article IV, held to its own rules.
 *
 * "Disputes are settled by randomly chosen trusted users."
 *
 * The report button has existed since the first build. Its reports went into a
 * queue no screen anywhere showed — written down, and then nothing happened to
 * them, for anybody, ever. So the bar here is not "a jury model exists". It is
 * that a report reaches people, those people decide it, and the decision
 * changes something.
 *
 * The rules under test:
 *   - A civil leader is somebody holding fifty delegations. The panel is 5 for
 *     a comment or an ordinary member's post, 7 for a civil leader's.
 *   - A CIVIL LEADER'S JURORS ARE NEVER THEIR OWN DELEGATORS. Nor the reporter,
 *     nor the accused, nor anybody blocked either way.
 *   - Accepting sequesters the account SERVER-SIDE, and the API says the same
 *     thing as the screen.
 *   - Signing out, account settings, the bug reporter and the case itself stay
 *     reachable, because an account nobody can leave is a trap.
 *   - Recusal releases them and redraws. So does running out of time.
 *   - A juror must say why.
 *   - Three of five decides it, and the report stops being open.
 *   - Prior findings are withheld until the verdict, then shown.
 *
 * Nothing here is mocked.
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
import {
  CIVIL_LEADER_DELEGATIONS,
  DELIBERATION_WINDOW_MS,
  PANELS,
  SUMMONS_WINDOW_MS,
  empanel,
  sweepJuries,
} from "../src/services/jury";

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(async () => {
  await resetData();
});

const DAY = 24 * 60 * 60 * 1000;

let seq = 0;
async function citizen(label = "juror") {
  seq += 1;
  return signUp({
    email: `${label}-jury-${seq}@example.com`,
    password: "test-password-not-a-real-one",
    name: `${label} ${seq}`,
  });
}

let refSeq = 0;
/**
 * Make somebody eligible to be drawn: the same bar already used for becoming a
 * delegate. The account age is the one thing a test cannot earn honestly, so
 * the date is backdated; everything else is real rows of the real kind.
 */
async function makeEligible(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { createdAt: new Date(Date.now() - 30 * DAY) },
  });
  for (let i = 0; i < 3; i += 1) {
    await prisma.post.create({
      data: { authorId: userId, content: `Something worth saying, number ${i}.` },
    });
  }
  for (let i = 0; i < 20; i += 1) {
    refSeq += 1;
    const row = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `jury-${refSeq}-119`,
        referenceType: "bill",
        title: `Track record ${refSeq}`,
        status: "proposed",
        category: "infrastructure",
      },
    });
    await prisma.governmentReferenceVote.create({
      data: { governmentReferenceId: row.id, userId, position: "support" },
    });
  }
}

/** A pool of eligible people nobody has any relationship with. */
async function pool(size: number) {
  const people = [];
  for (let i = 0; i < size; i += 1) {
    const person = await citizen("pool");
    await makeEligible(person.userId);
    people.push(person);
  }
  return people;
}

async function post(authorId: string, content = "A post somebody took exception to.") {
  return prisma.post.create({ data: { authorId, content } });
}

function api(cookie: string | null, path: string, method = "GET", body?: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method,
    headers: freshClientHeaders({
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** File a report through the real endpoint, the way the button does. */
async function report(cookie: string, target: { postId?: string; userId?: string; commentId?: string }) {
  const response = await api(cookie, "/api/safety/reports", "POST", {
    ...target,
    reason: "misinformation",
    detail: "This misstates what the bill actually says.",
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------

describe("[art4-sec3] a report reaches people", () => {
  test("REPORTING A POST DRAWS A JURY — the queue nobody read is gone", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    await pool(8);

    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    expect(filed.status).toBe(201);
    expect(filed.body.juryId).toBeTruthy();
    expect(filed.body.jurorsSummoned).toBe(PANELS.post.seats);

    const jury = await prisma.jury.findUnique({
      where: { id: filed.body.juryId as string },
      select: { seats: true, votesToDecide: true, panelKind: true, accusedId: true, status: true },
    });
    expect(jury?.seats).toBe(5);
    expect(jury?.votesToDecide).toBe(3);
    expect(jury?.accusedId).toBe(author.userId);
  });

  test("a summoned juror is told, and can see the summons", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    const jurors = await pool(6);

    const written = await post(author.userId);
    await report(reporter.cookie, { postId: written.id });

    const seats = await prisma.jurySeat.findMany({ select: { jurorId: true } });
    const seated = jurors.find((j) => seats.some((s) => s.jurorId === j.userId));
    expect(seated).toBeTruthy();

    const mine = await api(seated!.cookie, "/api/juries/me");
    const body = (await mine.json()) as { summonses: Array<{ state: string }> };
    expect(body.summonses.length).toBe(1);
    expect(body.summonses[0]!.state).toBe("summoned");

    const told = await prisma.notification.count({
      where: { userId: seated!.userId, type: "jury_summons" },
    });
    expect(told).toBe(1);
  });
});

describe("[art4-sec3] the panel scales with reach", () => {
  test(`somebody holding ${CIVIL_LEADER_DELEGATIONS} delegations gets a jury of ${PANELS.leader.seats}`, async () => {
    const leader = await citizen("leader");
    const reporter = await citizen("reporter");
    await pool(9);

    // Fifty people lend them a vote. These are NOT eligible jurors — they are
    // deliberately plain accounts, so the exclusion below is proved separately.
    const lenders = [];
    for (let i = 0; i < CIVIL_LEADER_DELEGATIONS; i += 1) lenders.push(await citizen("lender"));
    await prisma.delegation.createMany({
      data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: leader.userId })),
    });

    const written = await post(leader.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const jury = await prisma.jury.findUnique({
      where: { id: filed.body.juryId as string },
      select: { seats: true, votesToDecide: true, panelKind: true, accusedDelegations: true },
    });
    expect(jury?.panelKind).toBe("leader");
    expect(jury?.seats).toBe(7);
    expect(jury?.votesToDecide).toBe(4);
    expect(jury?.accusedDelegations).toBe(CIVIL_LEADER_DELEGATIONS);
  });

  test("one delegation short of the title is still a panel of five", async () => {
    const nearly = await citizen("nearly");
    const reporter = await citizen("reporter");
    await pool(8);

    const lenders = [];
    for (let i = 0; i < CIVIL_LEADER_DELEGATIONS - 1; i += 1) lenders.push(await citizen("lender"));
    await prisma.delegation.createMany({
      data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: nearly.userId })),
    });

    const written = await post(nearly.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const jury = await prisma.jury.findUnique({
      where: { id: filed.body.juryId as string },
      select: { seats: true, panelKind: true },
    });
    expect(jury?.panelKind).toBe("post");
    expect(jury?.seats).toBe(5);
  });

  test("a comment is a comment whoever wrote it", async () => {
    const leader = await citizen("leader");
    const reporter = await citizen("reporter");
    await pool(8);

    const lenders = [];
    for (let i = 0; i < CIVIL_LEADER_DELEGATIONS; i += 1) lenders.push(await citizen("lender"));
    await prisma.delegation.createMany({
      data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: leader.userId })),
    });

    const written = await post(reporter.userId);
    const comment = await prisma.comment.create({
      data: { postId: written.id, authorId: leader.userId, content: "A comment somebody minded." },
    });

    const filed = await report(reporter.cookie, { commentId: comment.id });
    const jury = await prisma.jury.findUnique({
      where: { id: filed.body.juryId as string },
      select: { seats: true, panelKind: true },
    });
    expect(jury?.panelKind).toBe("comment");
    expect(jury?.seats).toBe(5);
  });
});

describe("[art4-sec3] who may not sit", () => {
  test("A LEADER'S OWN DELEGATORS ARE NEVER ON THEIR JURY", async () => {
    const leader = await citizen("leader");
    const reporter = await citizen("reporter");

    // Ten people who would otherwise be perfectly good jurors — and who lend
    // this leader their vote. That single fact bars every one of them.
    const delegators = await pool(10);
    await prisma.delegation.createMany({
      data: delegators.map((d) => ({ fromUserId: d.userId, toUserId: leader.userId })),
    });
    const strangers = await pool(8);

    const written = await post(leader.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const seated = await prisma.jurySeat.findMany({
      where: { juryId: filed.body.juryId as string },
      select: { jurorId: true },
    });
    const seatedIds = seated.map((s) => s.jurorId);

    expect(seatedIds.length).toBeGreaterThan(0);
    for (const delegator of delegators) {
      expect(seatedIds).not.toContain(delegator.userId);
    }
    // And the strangers are exactly who is left.
    for (const id of seatedIds) {
      expect(strangers.map((s) => s.userId)).toContain(id);
    }
  });

  test("neither the accused nor the reporter sits", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    await makeEligible(author.userId);
    await makeEligible(reporter.userId);
    await pool(8);

    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const seated = await prisma.jurySeat.findMany({
      where: { juryId: filed.body.juryId as string },
      select: { jurorId: true },
    });
    const ids = seated.map((s) => s.jurorId);
    expect(ids).not.toContain(author.userId);
    expect(ids).not.toContain(reporter.userId);
  });

  test("somebody blocked either way does not sit", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    const blocked = await pool(1);
    const blocker = await pool(1);
    await pool(8);

    await prisma.block.create({
      data: { blockerId: author.userId, blockedId: blocked[0]!.userId },
    });
    await prisma.block.create({
      data: { blockerId: blocker[0]!.userId, blockedId: author.userId },
    });

    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const ids = (
      await prisma.jurySeat.findMany({
        where: { juryId: filed.body.juryId as string },
        select: { jurorId: true },
      })
    ).map((s) => s.jurorId);

    expect(ids).not.toContain(blocked[0]!.userId);
    expect(ids).not.toContain(blocker[0]!.userId);
  });

  test("somebody who has not earned it is not drawn", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    // Brand-new accounts with nothing behind them.
    const newcomers = [];
    for (let i = 0; i < 6; i += 1) newcomers.push(await citizen("newcomer"));

    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const ids = (
      await prisma.jurySeat.findMany({
        where: { juryId: filed.body.juryId as string },
        select: { jurorId: true },
      })
    ).map((s) => s.jurorId);

    expect(ids).toEqual([]);
    // A jury short of jurors is still a jury. The report is heard, not refused.
    expect(filed.body.juryId).toBeTruthy();
  });
});

describe("[art4-sec3] accepting is a duty", () => {
  /** Set a case up and hand back a juror sitting on it. */
  async function empanelled() {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    const jurors = await pool(8);
    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });
    const juryId = filed.body.juryId as string;

    const seats = await prisma.jurySeat.findMany({ where: { juryId }, select: { jurorId: true } });
    const seated = jurors.filter((j) => seats.some((s) => s.jurorId === j.userId));
    return { juryId, seated, author, reporter, written };
  }

  test("THE PLATFORM CLOSES AROUND THE CASE — on the server, not the screen", async () => {
    const { juryId, seated } = await empanelled();
    const juror = seated[0]!;

    // Before accepting, the app is the app.
    expect((await api(juror.cookie, "/api/feed")).status).toBe(200);

    const accepted = await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
    expect(accepted.status).toBe(200);

    // After accepting, it is not.
    const feed = await api(juror.cookie, "/api/feed");
    expect(feed.status).toBe(423);
    const body = (await feed.json()) as { sequestered: boolean; juryId: string };
    expect(body.sequestered).toBe(true);
    expect(body.juryId).toBe(juryId);
  });

  test("…and the case, sign-out, settings and the bug reporter stay open", async () => {
    const { juryId, seated } = await empanelled();
    const juror = seated[0]!;
    await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");

    // The case they are sitting on.
    expect((await api(juror.cookie, `/api/juries/${juryId}`)).status).toBe(200);
    // Account settings, which live under /api/users/me.
    expect((await api(juror.cookie, "/api/users/me/jurisdiction")).status).toBe(200);
    // "The decision page is broken."
    expect((await api(juror.cookie, "/api/bug-reports/mine")).status).not.toBe(423);
    // Signing out is never blocked.
    expect((await api(juror.cookie, "/api/auth/get-session")).status).toBe(200);
  });

  test("a juror gets everything the case can show them", async () => {
    const { juryId, seated } = await empanelled();
    const juror = seated[0]!;
    await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");

    const file = (await (await api(juror.cookie, `/api/juries/${juryId}`)).json()) as {
      case: {
        post: { content: string } | null;
        report: { reason: string; detail: string | null };
        accused: { id: string } | null;
        priorFindings: number | null;
      };
    };

    expect(file.case.post?.content).toContain("A post somebody took exception to");
    expect(file.case.report.reason).toBe("misinformation");
    expect(file.case.report.detail).toContain("misstates");
    expect(file.case.accused).not.toBeNull();

    // PRIOR FINDINGS ARE WITHHELD UNTIL THE VERDICT. A jury that starts by
    // reading somebody's record is weighing the person, not the case.
    expect(file.case.priorFindings).toBeNull();
  });

  test("A JUROR MUST SAY WHY", async () => {
    const { juryId, seated } = await empanelled();
    const juror = seated[0]!;
    await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");

    const thin = await api(juror.cookie, `/api/juries/${juryId}/verdict`, "POST", {
      vote: "uphold",
      reasoning: "no",
    });
    expect(thin.status).toBe(400);
    expect(((await thin.json()) as { error: string }).error).toContain("Say why");
  });

  test("voting releases them, and three of five decides it", async () => {
    const { juryId, seated } = await empanelled();
    expect(seated.length).toBe(5);

    for (const juror of seated.slice(0, 2)) {
      await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
      const cast = await api(juror.cookie, `/api/juries/${juryId}/verdict`, "POST", {
        vote: "uphold",
        reasoning: "The post states the opposite of what the section it cites actually says.",
      });
      expect(cast.status).toBe(200);
      expect(((await cast.json()) as { decided: boolean }).decided).toBe(false);
      // Voting ends the sequestration then and there.
      expect((await api(juror.cookie, "/api/feed")).status).toBe(200);
    }

    const third = seated[2]!;
    await api(third.cookie, `/api/juries/${juryId}/accept`, "POST");
    const closing = await api(third.cookie, `/api/juries/${juryId}/verdict`, "POST", {
      vote: "uphold",
      reasoning: "Agreed — the citation does not support the claim made above it.",
    });
    const body = (await closing.json()) as { decided: boolean; verdict: string };
    expect(body.decided).toBe(true);
    expect(body.verdict).toBe("upheld");

    // THE REPORT IS ANSWERED AT LAST.
    const answered = await prisma.report.findFirst({ select: { status: true, reviewedBy: true } });
    expect(answered?.status).toBe("actioned");
    expect(answered?.reviewedBy).toBe("community jury");

    // And nobody is left sitting on a case that is over.
    const stillSitting = await prisma.jurySeat.count({
      where: { juryId, state: { in: ["summoned", "accepted"] } },
    });
    expect(stillSitting).toBe(0);
  });

  test("the verdict and the reasons are published, unattributed", async () => {
    const { juryId, seated } = await empanelled();
    for (const juror of seated.slice(0, 3)) {
      await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
      await api(juror.cookie, `/api/juries/${juryId}/verdict`, "POST", {
        vote: "dismiss",
        reasoning: "Disagreeable, but it does not break any rule the platform actually has.",
      });
    }

    // Signed out. A decided case is public.
    const open = await api(null, `/api/juries/${juryId}`);
    expect(open.status).toBe(200);
    const file = (await open.json()) as {
      case: { verdict: string; reasons: Array<{ vote: string; reasoning: string }>; priorFindings: number | null };
    };
    expect(file.case.verdict).toBe("dismissed");
    expect(file.case.reasons.length).toBe(3);
    expect(file.case.reasons[0]!.reasoning).toContain("does not break any rule");
    // Whose reason is whose is never said.
    expect(JSON.stringify(file.case.reasons)).not.toContain("jurorId");
    // And now the record is shown.
    expect(file.case.priorFindings).toBe(0);
  });

  test("a live case is not published to strangers", async () => {
    const { juryId } = await empanelled();
    const passerby = await citizen("passerby");
    const looking = await api(passerby.cookie, `/api/juries/${juryId}`);
    expect(looking.status).toBe(403);
  });
});

describe("[art4-sec3] nobody is trapped", () => {
  async function empanelled() {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    const jurors = await pool(9);
    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });
    const juryId = filed.body.juryId as string;
    const seats = await prisma.jurySeat.findMany({ where: { juryId }, select: { jurorId: true } });
    return { juryId, seated: jurors.filter((j) => seats.some((s) => s.jurorId === j.userId)) };
  }

  test("RECUSING RELEASES THEM AND DRAWS A REPLACEMENT", async () => {
    const { juryId, seated } = await empanelled();
    const juror = seated[0]!;
    await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
    expect((await api(juror.cookie, "/api/feed")).status).toBe(423);

    const out = await api(juror.cookie, `/api/juries/${juryId}/recuse`, "POST", {
      reason: "I know the person this is about.",
    });
    expect(out.status).toBe(200);

    // Released immediately.
    expect((await api(juror.cookie, "/api/feed")).status).toBe(200);

    // The seat is kept, and a fresh juror is drawn.
    const seat = await prisma.jurySeat.findFirst({
      where: { juryId, jurorId: juror.userId },
      select: { state: true, recusedReason: true },
    });
    expect(seat?.state).toBe("recused");
    expect(seat?.recusedReason).toContain("I know the person");

    const live = await prisma.jurySeat.count({
      where: { juryId, state: { in: ["summoned", "accepted"] } },
    });
    expect(live).toBe(PANELS.post.seats);
  });

  test("A JUROR WHO GOES QUIET IS REPLACED, and the seat is kept", async () => {
    const { juryId, seated } = await empanelled();
    const quiet = seated[0]!;

    await prisma.jurySeat.updateMany({
      where: { juryId, jurorId: quiet.userId },
      data: { summonedAt: new Date(Date.now() - SUMMONS_WINDOW_MS - 60_000) },
    });

    const swept = await sweepJuries();
    expect(swept.released).toBeGreaterThanOrEqual(1);

    const seat = await prisma.jurySeat.findFirst({
      where: { juryId, jurorId: quiet.userId },
      select: { state: true },
    });
    // Kept, not deleted — that record is what the Trust Score reads.
    expect(seat?.state).toBe("lapsed");

    const live = await prisma.jurySeat.count({
      where: { juryId, state: { in: ["summoned", "accepted"] } },
    });
    expect(live).toBe(PANELS.post.seats);
  });

  test("AN ACCOUNT COMES BACK AFTER A DAY, whether or not any sweep ran", async () => {
    const { juryId, seated } = await empanelled();
    const juror = seated[0]!;
    await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
    expect((await api(juror.cookie, "/api/feed")).status).toBe(423);

    // They lost their phone. No sweep is run here on purpose: the release is
    // computed from the seat row on every request, so a background job that
    // never fires cannot leave somebody locked out.
    await prisma.jurySeat.updateMany({
      where: { juryId, jurorId: juror.userId },
      data: { acceptedAt: new Date(Date.now() - DELIBERATION_WINDOW_MS - 60_000) },
    });

    expect((await api(juror.cookie, "/api/feed")).status).toBe(200);
  });
});

describe("[art4-sec3] the rules are published and the draw is checkable", () => {
  test("the panel table is served, so no client hardcodes it", async () => {
    const response = await api(null, "/api/juries/rules");
    const body = (await response.json()) as {
      panels: typeof PANELS;
      civilLeaderDelegations: number;
    };
    expect(body.civilLeaderDelegations).toBe(CIVIL_LEADER_DELEGATIONS);
    expect(body.panels.leader.seats).toBe(7);
    expect(body.panels.leader.votesToDecide).toBe(4);
    expect(body.panels.comment.seats).toBe(5);
  });

  test("every seat ever drawn is on the record, replacements included", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    const jurors = await pool(9);
    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });
    const juryId = filed.body.juryId as string;

    const seats = await prisma.jurySeat.findMany({ where: { juryId }, select: { jurorId: true } });
    const seated = jurors.filter((j) => seats.some((s) => s.jurorId === j.userId));
    await api(seated[0]!.cookie, `/api/juries/${juryId}/recuse`, "POST", { reason: "Cannot." });

    const rows = await prisma.jurySeat.findMany({
      where: { juryId },
      select: { state: true, replacesSeatId: true },
    });
    expect(rows.length).toBe(PANELS.post.seats + 1);
    expect(rows.filter((r) => r.state === "recused").length).toBe(1);
    expect(rows.some((r) => r.replacesSeatId !== null)).toBe(true);
  });

  test("one report, one jury — a second empanelment is refused", async () => {
    const author = await citizen("author");
    const reporter = await citizen("reporter");
    await pool(8);
    const written = await post(author.userId);
    const filed = await report(reporter.cookie, { postId: written.id });

    const again = await empanel(filed.body.reportId as string);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("already_empanelled");
  });
});

// ---------------------------------------------------------------------------

describe("[bor-art5] a leader is held to what they said", () => {
  /**
   * Run a misinformation report all the way to an upheld verdict.
   *
   * Returns the accused, the people lending them a vote, and the jury id.
   */
  async function upheldMisinformation(lenderCount: number) {
    const leader = await citizen("leader");
    const reporter = await citizen("reporter");
    const jurors = await pool(8);

    const lenders = [];
    for (let i = 0; i < lenderCount; i += 1) lenders.push(await citizen("lender"));
    if (lenders.length > 0) {
      await prisma.delegation.createMany({
        data: lenders.map((l) => ({ fromUserId: l.userId, toUserId: leader.userId })),
      });
    }

    const written = await post(leader.userId, "This bill removes the protection in section four.");
    const filed = await report(reporter.cookie, { postId: written.id });
    const juryId = filed.body.juryId as string;

    const seats = await prisma.jurySeat.findMany({ where: { juryId }, select: { jurorId: true } });
    const seated = jurors.filter((j) => seats.some((s) => s.jurorId === j.userId));

    for (const juror of seated.slice(0, 3)) {
      await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
      await api(juror.cookie, `/api/juries/${juryId}/verdict`, "POST", {
        vote: "uphold",
        reasoning: "Section four plainly keeps the protection this post says it removes.",
      });
    }

    return { leader, reporter, lenders, juryId };
  }

  test("AN UPHELD MISINFORMATION REPORT BECOMES A FINDING ON THE RECORD", async () => {
    const { leader, juryId } = await upheldMisinformation(3);

    const response = await api(null, `/api/juries/findings/${leader.userId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      findings: Array<{ juryId: string; uphold: number; detail: string | null; reasons: unknown[]; delegationsAtTheTime: number }>;
    };

    expect(body.findings.length).toBe(1);
    expect(body.findings[0]!.juryId).toBe(juryId);
    expect(body.findings[0]!.uphold).toBe(3);
    // The claim, not just the label — a reader judges what was said.
    expect(body.findings[0]!.detail).toContain("misstates what the bill actually says");
    // And the jurors' reasons, so the finding can be argued with.
    expect(body.findings[0]!.reasons.length).toBe(3);
    expect(body.findings[0]!.delegationsAtTheTime).toBe(3);
  });

  test("EVERY PERSON LENDING THEM A VOTE IS TOLD — at one delegation, not fifty", async () => {
    const { lenders } = await upheldMisinformation(3);

    // Not awaited into the verdict, so give the side effect a moment.
    await Bun.sleep(1_500);

    for (const lender of lenders) {
      const told = await prisma.notification.count({
        where: { userId: lender.userId, type: "leader_finding" },
      });
      expect(told).toBe(1);
    }
  });

  test("NOTHING IS TAKEN AWAY BY A FINDING — the remedy belongs to the lenders", async () => {
    const { leader, lenders } = await upheldMisinformation(3);

    const after = await prisma.user.findUnique({
      where: { id: leader.userId },
      select: { banned: true },
    });
    expect(after?.banned).toBe(false);

    // Every delegation is still standing. A jury decides whether something
    // broke the rules; whether to keep lending a voice is the lender's call,
    // and Article V is how they make it together.
    const stillLending = await prisma.delegation.count({
      where: { toUserId: leader.userId, isActive: true },
    });
    expect(stillLending).toBe(lenders.length);

    // And they can still speak — nothing about the account changed at all.
    // A post has to name the record it is about, so this one does.
    refSeq += 1;
    const about = await prisma.governmentReference.create({
      data: {
        masterReferenceId: `finding-${refSeq}-119`,
        referenceType: "bill",
        title: "A bill they still have every right to talk about",
        status: "proposed",
        category: "healthcare",
      },
    });
    const canStillPost = await api(leader.cookie, "/api/posts", "POST", {
      content: "Still able to speak, which is the point.",
      governmentReferenceId: about.id,
    });
    expect(canStillPost.status).toBe(201);
  });

  test("a dismissed report is never a finding", async () => {
    const leader = await citizen("leader");
    const reporter = await citizen("reporter");
    const jurors = await pool(8);
    await prisma.delegation.create({
      data: { fromUserId: reporter.userId, toUserId: leader.userId },
    });

    const written = await post(leader.userId);
    const filed = await report(reporter.cookie, { postId: written.id });
    const juryId = filed.body.juryId as string;
    const seats = await prisma.jurySeat.findMany({ where: { juryId }, select: { jurorId: true } });
    const seated = jurors.filter((j) => seats.some((s) => s.jurorId === j.userId));

    for (const juror of seated.slice(0, 3)) {
      await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
      await api(juror.cookie, `/api/juries/${juryId}/verdict`, "POST", {
        vote: "dismiss",
        reasoning: "Disagreeable, but it does not misstate what the law says.",
      });
    }

    const body = (await (await api(null, `/api/juries/findings/${leader.userId}`)).json()) as {
      findings: unknown[];
    };
    expect(body.findings).toEqual([]);
  });

  test("an upheld report of another kind is not a falsehood finding", async () => {
    const leader = await citizen("leader");
    const reporter = await citizen("reporter");
    const jurors = await pool(8);

    const written = await post(leader.userId);
    // Reported as spam, not as misrepresenting a law.
    const filed = await api(reporter.cookie, "/api/safety/reports", "POST", {
      postId: written.id,
      reason: "spam",
      detail: "Posted this same thing eleven times today.",
    });
    const juryId = ((await filed.json()) as { juryId: string }).juryId;

    const seats = await prisma.jurySeat.findMany({ where: { juryId }, select: { jurorId: true } });
    const seated = jurors.filter((j) => seats.some((s) => s.jurorId === j.userId));
    for (const juror of seated.slice(0, 3)) {
      await api(juror.cookie, `/api/juries/${juryId}/accept`, "POST");
      await api(juror.cookie, `/api/juries/${juryId}/verdict`, "POST", {
        vote: "uphold",
        reasoning: "Eleven identical posts in a day is spam by any reading.",
      });
    }

    const body = (await (await api(null, `/api/juries/findings/${leader.userId}`)).json()) as {
      findings: unknown[];
    };
    // Upheld, and on the record as a decided case — but Bill of Rights Article V
    // is about verifiable falsehoods, and this was not one.
    expect(body.findings).toEqual([]);
  });

  test("somebody lending nobody a vote still gets the finding, and nobody is told", async () => {
    const { leader } = await upheldMisinformation(0);
    await Bun.sleep(1_000);

    const body = (await (await api(null, `/api/juries/findings/${leader.userId}`)).json()) as {
      findings: Array<{ delegationsAtTheTime: number }>;
    };
    expect(body.findings.length).toBe(1);
    expect(body.findings[0]!.delegationsAtTheTime).toBe(0);

    const told = await prisma.notification.count({ where: { type: "leader_finding" } });
    expect(told).toBe(0);
  });

  test("the record is public — a stranger can read it, signed out", async () => {
    const { leader } = await upheldMisinformation(2);
    const response = await api(null, `/api/juries/findings/${leader.userId}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { findings: unknown[] };
    expect(body.findings.length).toBe(1);
  });
});
