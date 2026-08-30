/**
 * CLOSING AN ACCOUNT REMOVES EVERY TRACE OF THE PERSON.
 *
 * THE RULE, in the owner's words: "any account deletion removes all trace of
 * the user, but does not undo the results of their votes. So if they were on a
 * jury or voted to impeach or a system reset took effect that their vote was a
 * part of, it does not undo those actions once those proceedings are complete.
 * If they delete their account mid proceedings then their vote is removed — in
 * the case of a jury their vote is removed and a new juror is randomly
 * selected."
 *
 * And the reason, also his: holding somebody's data to keep our own system tidy
 * violates their sovereignty, and leaving is a decision that should have real
 * consequences for them and for everyone else.
 *
 *   Proceeding FINISHED        the outcome stands; the person's name comes off
 *   Proceeding STILL RUNNING   the vote is pulled out
 *     …on a jury                 and a replacement juror is drawn at random
 *     …impeachment or reset      no replacement; the threshold recalculates
 *   Ordinary law votes         always live, so always pulled — the Pulse moves
 *
 * WHY "THE OUTCOME STANDS" NEEDS NO SPECIAL CASE. Every concluded proceeding
 * writes its result onto its own row: Jury.verdict and decidedAt, then
 * Impeachment.status, then SystemReset.status and executedAt. None of them is
 * recomputed from the ballots afterwards. So removing a departed person's seat
 * or ballot cannot change a verdict that has already been recorded — the
 * outcome is a fact about the proceeding, not a running total.
 *
 * WHAT WAS ACTUALLY BROKEN. Deleting a user cascaded through fifty
 * relationships and looked complete. Eleven tables hold a person's id as a
 * plain column with no link back to the account, so nothing touched them:
 *
 *   GovernmentReferenceVote   ← the reported bug. The vote row survived the
 *                               account, the Pulse kept counting it, and a
 *                               deleted person went on voting forever.
 *   PostLike  PostSave  PostShare  UserInteraction  CreatorMetrics
 *   UserFeedProfile  Media  BugReport  SystemResetBallot
 *   SystemResetJournalVote
 *
 * ONE ROUTINE, TWO DOORS. The person's own "delete my account" and the admin
 * console both call this, so the two can never drift into meaning different
 * things. tests/account-deletion.test.ts scans EVERY table for the id
 * afterwards rather than checking this list, so a table added next year fails
 * there instead of quietly keeping somebody.
 */

import { prisma } from "../prisma";
import { purgeMediaObjects } from "./media-objects";
import { fillSeats } from "./jury";
import { applyWeightedTally } from "./delegation-service";
import { notifyFilerLeft } from "./notification-service";

export interface DeletionOutcome {
  ok: boolean;
  /** Why it could not proceed. Only set when ok is false. */
  message?: string;
  /** Juries that lost a seat and had a replacement drawn. */
  juriesRedrawn: number;
  /** Open impeachments and resets the person's ballot was pulled from. */
  ballotsPulled: number;
  /** Stored objects removed. */
  mediaPurged: number;
  /** Laws whose published tally was recomputed without this person in it. */
  talliesRepublished?: number;
}

/**
 * A jury still sitting. "drawing" and "deliberating" are the live states; a
 * decided or abandoned jury is finished and its seats are history.
 */
const LIVE_JURY = ["drawing", "deliberating"];

/** A seat that still counts. Recused and lapsed seats are already closed. */
const LIVE_SEAT = ["summoned", "accepted"];

/**
 * Remove an account and everything that identifies the person behind it.
 *
 * Irreversible by design. Nothing here writes a tombstone, an anonymised
 * placeholder, or a copy anywhere else: a "deleted" account that leaves a
 * shadow is the thing this exists to prevent.
 */
export async function deleteAccount(userId: string): Promise<DeletionOutcome> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, username: true },
  });
  if (!user) {
    return { ok: false, message: "No such account.", juriesRedrawn: 0, ballotsPulled: 0, mediaPurged: 0 };
  }

  /**
   * The handle this person was publicly known by, read BEFORE anything is
   * removed. Null when they never had one.
   *
   * WHY IT IS USED AT ALL. Article V makes a filing public — "THE ARTICLES ARE
   * PUBLIC. A charge brought in secret, decided by a private electorate, is
   * exactly the concentration of power Article V exists to break. The vote is
   * restricted; the accusation is not." The electors could already see who
   * brought the case, so naming them in the notice tells them nothing new. It
   * lets them place the notice against articles they have been reading.
   *
   * WHY NOT publicHandle(). That helper never returns null: with no username it
   * builds "citizen-<last six of the id>". That is a derived identifier rather
   * than a name anybody knows them by, and writing it into a notification that
   * outlives the account would leave a fragment of a deleted person's id
   * standing in the database forever. A real handle was already public; a
   * generated stand-in never was.
   *
   * Nowhere else. Every other trace of this person is removed.
   */
  const filerLabel = user.username?.trim() ? `@${user.username.trim()}` : null;

  // ---------------------------------------------------------------- juries
  //
  // Done FIRST and outside the transaction below, because drawing a
  // replacement juror reads the pool of eligible people and writes a new seat —
  // work that must happen while the account is still there to be excluded from
  // it, and that must not be rolled back by a later failure. A jury that lost a
  // juror and gained a replacement is correct even if the delete then fails;
  // the person simply tries again.
  const liveSeats = await prisma.jurySeat.findMany({
    where: { jurorId: userId, state: { in: LIVE_SEAT }, jury: { status: { in: LIVE_JURY } } },
    select: { id: true, juryId: true },
  });

  for (const seat of liveSeats) {
    await prisma.jurySeat.updateMany({
      where: { id: seat.id, state: { in: LIVE_SEAT } },
      data: {
        state: "recused",
        // No name in the reason. The seat row survives as part of the draw's
        // history and must not carry the person out with it.
        recusedReason: "The account was closed.",
        closedAt: new Date(),
      },
    });
    // The same redraw a recusal uses, so a departure and a step-aside are the
    // same event as far as the jury is concerned: the seat is refilled at
    // random and records which seat it replaced.
    await fillSeats(seat.juryId, seat.id);
  }

  // --------------------------------------------- open impeachments and resets
  //
  // Pulled rather than kept. There is no seat to refill — the threshold for
  // both is a proportion of everyone entitled, so it simply recalculates
  // against the smaller number, which is the honest arithmetic once somebody is
  // no longer here to have voted.
  //
  // A CONCLUDED proceeding is left alone here and the rows go with the account
  // below. The result is already written on the proceeding itself.
  const openImpeachments = await prisma.impeachmentElector.deleteMany({
    where: { voterId: userId, impeachment: { status: "open" } },
  });

  const openResets = await prisma.systemResetBallot.deleteMany({
    where: { voterId: userId, reset: { status: "voting" } },
  });

  // ------------------------------------------- proceedings this person FILED
  //
  // THE PROCEEDING SURVIVES THEM, AND EVERY ELECTOR IS TOLD.
  //
  // Impeachment.filedById used to cascade, so closing the filer's account
  // deleted the articles, the evidence, and every elector's vote in them. One
  // person walking away erased other people's participation in a
  // constitutional act they had nothing to do with. It is SET NULL now — see
  // the migration — so the case stands with the filer's name off it.
  //
  // The owner's instruction, and the second half is the part that matters:
  // "proceedings may survive but everyone that's got a right to vote in the
  // proceedings is notified that the filer has deleted their profile."
  //
  // The notice NAMES them, because Article V already made the filing public and
  // the electors could see who brought it. It also says "deleted their profile"
  // rather than a softer word, because that is what happened and it cannot be
  // undone.
  //
  // Everyone ENTITLED to vote, not everyone who has voted. Somebody who has not
  // voted yet is exactly who this matters most to: they still have the decision
  // in front of them, and who brought a case is part of judging it.
  //
  // Only OPEN proceedings. A concluded one is history; telling people the
  // origin of a decided case has changed would be noise about something they
  // can no longer act on.
  const filedOpen = await prisma.impeachment.findMany({
    where: { filedById: userId, status: "open" },
    select: { id: true, leaderId: true, electors: { select: { voterId: true } } },
  });

  for (const proceeding of filedOpen) {
    const electors = proceeding.electors
      .map((elector) => elector.voterId)
      .filter((id) => id !== userId);
    await notifyFilerLeft("impeachment", proceeding.id, electors, filerLabel, proceeding.leaderId);
  }

  // SystemReset was already built this way — filedById is a bare column with no
  // relation at all, precisely so a reset cannot vanish with its filer. Its
  // electorate is every account, so the notice goes to everyone who has a
  // ballot in the open vote.
  const resetsFiled = await prisma.systemReset.findMany({
    where: { filedById: userId, status: { in: ["voting", "scheduled"] } },
    select: { id: true, ballots: { select: { voterId: true } } },
  });

  for (const reset of resetsFiled) {
    const voters = reset.ballots
      .map((ballot) => ballot.voterId)
      .filter((id) => id !== userId);
    await notifyFilerLeft("system_reset", reset.id, voters, filerLabel);
  }

  // AND THEN THEIR NAME COMES OFF IT — every reset they filed, open or long
  // since executed. Having no foreign key kept the proceeding safe and also
  // meant nothing was ever going to clear this column: the id of somebody who
  // closed their account sat in it permanently. Both readers already treat a
  // filer they cannot find as "we no longer know", so this is the honest state
  // rather than a broken one.
  await prisma.systemReset.updateMany({
    where: { filedById: userId },
    data: { filedById: null },
  });

  // ----------------------------------------------------------------- media
  //
  // Every object they ever uploaded, not only what they posted. Media.userId is
  // a bare column: the cascade reaches attached media through Post, and misses
  // entirely anything uploaded and never posted — so a closed account used to
  // leave every photo it had ever uploaded publicly fetchable.
  //
  // Objects go before rows. If the store refuses, nothing is deleted and the
  // person is told, rather than losing the rows that point at the files.
  const media = await prisma.media.findMany({
    where: { userId },
    select: { id: true, url: true, thumbnailUrl: true },
  });

  const purge = await purgeMediaObjects(media, `account ${userId}`);
  if (!purge.ok) {
    return {
      ok: false,
      message: purge.message,
      juriesRedrawn: liveSeats.length,
      ballotsPulled: openImpeachments.count + openResets.count,
      mediaPurged: 0,
    };
  }

  // ------------------------------------------------------ which laws they voted on
  //
  // Collected BEFORE the rows go, because after the delete there is nothing
  // left to say which records need their published tally recomputed.
  const votedOn = await prisma.governmentReferenceVote.findMany({
    where: { userId },
    select: { governmentReferenceId: true },
  });

  // ------------------------------------------------- everything that is theirs
  //
  // One transaction. A half-deleted account is worse than an undeleted one: the
  // person has been told they are gone while some of them is still here.
  //
  // The bare-column tables are listed explicitly because nothing else will
  // reach them. Everything with a real relation to User cascades when the row
  // goes, which is the last statement.
  await prisma.$transaction([
    prisma.governmentReferenceVote.deleteMany({ where: { userId } }),
    prisma.postLike.deleteMany({ where: { userId } }),
    prisma.postSave.deleteMany({ where: { userId } }),
    prisma.postShare.deleteMany({ where: { userId } }),
    prisma.userInteraction.deleteMany({ where: { userId } }),
    prisma.creatorMetrics.deleteMany({ where: { userId } }),
    prisma.userFeedProfile.deleteMany({ where: { userId } }),
    prisma.media.deleteMany({ where: { userId } }),
    prisma.bugReport.deleteMany({ where: { userId } }),
    // Their ballot in a reset that has already run. The journal exists so the
    // reset can be walked backwards; a row naming somebody who has left is
    // exactly the trace being removed, and the reset's own outcome does not
    // depend on it.
    prisma.systemResetJournalVote.deleteMany({ where: { userId } }),
    prisma.systemResetBallot.deleteMany({ where: { voterId: userId } }),
    // An audit somebody demanded. The audit itself belongs to the record it was
    // run against, not to the person who asked for it — and audits never name
    // anybody, so there is nothing here to preserve.
    prisma.integrityAudit.deleteMany({ where: { requestedById: userId } }),
    // And the account, which takes every cascading relation with it.
    prisma.user.delete({ where: { id: userId } }),
  ]);

  // ------------------------------------------------------------- the Pulse
  //
  // THE PUBLISHED COUNT IS A STORED NUMBER, NOT A LIVE ONE. GovernmentReference
  // carries supportVotes and opposeVotes, written by applyWeightedTally when a
  // vote is cast or a delegation moves. Deleting the vote row therefore does
  // NOT change what the card says — the ballot is gone and the tally still
  // counts it.
  //
  // That is the reported bug in its real shape, and it is worse than the one
  // that was reported. "A deleted account keeps voting" sounded like a stale
  // row nobody reads. It is the published number on the law page.
  //
  // Found by the test, not by reading this file: the account was gone, the vote
  // row was gone, the sweep was clean, and the endpoint still answered two.
  //
  // Republished one record at a time, after the transaction. Each call takes a
  // row lock, so doing this inside the delete would hold every affected
  // record's lock for the whole operation.
  const laws = [...new Set(votedOn.map((row) => row.governmentReferenceId))];
  for (const referenceId of laws) {
    await applyWeightedTally(referenceId);
  }

  return {
    ok: true,
    juriesRedrawn: liveSeats.length,
    ballotsPulled: openImpeachments.count + openResets.count,
    mediaPurged: purge.deleted,
    /** Laws whose published tally moved because this person left. */
    talliesRepublished: laws.length,
  };
}
