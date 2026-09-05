/**
 * Where an executive order's number comes from: the Federal Register, and
 * nowhere else.
 *
 * WHY NOWHERE ELSE. The White House prints a number on its own listing, and on
 * a freshly signed order it is wrong — 14420 appeared on two different orders
 * in August 2026, and the Register later called one of them 14421. The number
 * is assigned by the Office of the Federal Register, and until that office has
 * spoken the order does not have one. A record read from whitehouse.gov
 * therefore arrives named for the day it was signed (eo-2026-09-04*, then -2*,
 * -3*) and this pass is what eventually replaces that with the real thing.
 *
 * THREE ANSWERS, AND A FOURTH THAT IS NOT AN ANSWER.
 *
 *   numbered            rename the record, drop the star, done
 *   published, no number  the Register does publish presidential documents with
 *                       the number field empty, filed as "Presidential Order"
 *                       or "Other" — the Antifa designation and the EMCORE
 *                       divestment among them. That is a permanent answer, not
 *                       a failure, and the record stops being asked about.
 *   not published yet   ask again tomorrow
 *   could not ask       change NOTHING
 *
 * That last one is the one worth being careful about. An unreachable source
 * that gets treated as "nothing to fix" is how a record sits mis-numbered
 * forever while a daily job reports success.
 *
 * WHEN THE REAL NUMBER IS ALREADY TAKEN. Somebody else — usually the Register's
 * own nightly sync — got there first, and now two records both want to be
 * eo-14424. That is a duplicate, and it goes through the adjudicator that
 * already exists: identical text merges automatically, a model decides the
 * pairs the government has linked, and anything it is unsure about goes to the
 * Merge review queue in the admin portal for a person to answer.
 */
import { prisma } from "../prisma";
import { adjudicate, recordFor } from "./merge-adjudicator";
import { mergeReferences } from "./deduplication-service";
import { officialSourceHeaders } from "./official-source";
import { CandidateStatus, fileCandidate } from "./reference-lineage";
import { NameSource, renameReference } from "./reference-names";
import { orderTitleKey, titleCloseness } from "./white-house-orders";
import { SAME_ORDER_CLOSENESS } from "./executive-order-intake";

export const NumberStatus = {
  /** Read from the White House; the Register has not published it yet. */
  PENDING: "pending",
  /** The Register published it and gave it a number. */
  CONFIRMED: "confirmed",
  /** The Register published it WITHOUT a number. Permanent. */
  NEVER_NUMBERED: "never_numbered",
} as const;

/**
 * How long to wait before asking the first time.
 *
 * The Register's median lag is 5 days and its fastest measured is 1. Asking
 * from day 3 costs two requests that will usually find nothing and buys the
 * chance of confirming an unusually fast one early. Every day after that, the
 * pass asks again.
 */
export const FIRST_ASK_AFTER_DAYS = 3;

/**
 * How far before our signing date to search.
 *
 * The White House is occasionally late — twice in 82 measured orders, by one
 * day and by four — and never early, so the true signing date can only be
 * earlier than the one we recorded. Widening to ten days recovered the one late
 * order in the measured set (ours 2026-01-27, the Register's 2026-01-23, EO
 * 14377) and produced no wrong match anywhere in the other 89.
 */
const SIGNING_WINDOW_DAYS = 10;

interface RegisterDocument {
  title: string;
  subtype: string | null;
  executive_order_number: string | null;
  signing_date: string | null;
  publication_date: string | null;
  html_url: string | null;
  document_number: string | null;
}

function registerQuery(from: string, to: string): string {
  const params = new URLSearchParams();
  // PRESDOCU covers every presidential document, deliberately: filtering to
  // presidential_document_type=executive_order would hide exactly the documents
  // this pass needs to recognise as never_numbered.
  params.append("conditions[type][]", "PRESDOCU");
  params.append("conditions[signing_date][gte]", from);
  params.append("conditions[signing_date][lte]", to);
  params.append("per_page", "100");
  for (const field of [
    "title",
    "subtype",
    "executive_order_number",
    "signing_date",
    "publication_date",
    "html_url",
    "document_number",
  ]) {
    params.append("fields[]", field);
  }
  return `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
}

function isoDay(when: Date): string {
  return when.toISOString().slice(0, 10);
}

function daysBefore(when: Date, days: number): Date {
  const out = new Date(when);
  out.setUTCDate(out.getUTCDate() - days);
  return out;
}

/**
 * What the Register published around a date. Null means we could not ask.
 */
export async function askTheRegister(signedDate: Date): Promise<RegisterDocument[] | null> {
  const url = registerQuery(isoDay(daysBefore(signedDate, SIGNING_WINDOW_DAYS)), isoDay(signedDate));
  try {
    const response = await fetch(url, {
      headers: officialSourceHeaders({ Accept: "application/json" }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { results?: RegisterDocument[] };
    // A window with nothing in it is a legitimate empty answer; a body with no
    // results key at all is a shape we do not recognise, and guessing at it is
    // how a parser silently starts returning "nothing published".
    if (!body || !("results" in body)) return null;
    return body.results ?? [];
  } catch {
    return null;
  }
}

/**
 * The Register's copy of one order, out of everything it published that week.
 *
 * Proclamations are excluded by subtype rather than by title: "National
 * Hispanic Heritage Month" and an executive order signed the same day can share
 * words, and a proclamation is not the thing we are holding.
 */
export function findInRegister(
  title: string,
  documents: RegisterDocument[],
): RegisterDocument | null {
  const usable = documents.filter((doc) => (doc.subtype ?? "").toLowerCase() !== "proclamation");

  const key = orderTitleKey(title);
  const exact = usable.find((doc) => orderTitleKey(doc.title) === key);
  if (exact) return exact;

  let best: RegisterDocument | null = null;
  let bestScore = 0;
  for (const doc of usable) {
    const score = titleCloseness(doc.title, title);
    if (score > bestScore) {
      best = doc;
      bestScore = score;
    }
  }
  return bestScore >= SAME_ORDER_CLOSENESS ? best : null;
}

export interface NumberingReport {
  /** Records still waiting that were old enough to ask about. */
  asked: number;
  /** Renamed to a real order number. */
  confirmed: number;
  /** Published by the Register with no number, permanently. */
  neverNumbered: number;
  /** Not published yet. Asked again tomorrow. */
  stillWaiting: number;
  /** The Register could not be reached. Nothing changed for these. */
  unreachable: number;
  /** The real number was already held by another record. */
  collided: number;
  /** Of those, folded into one record. */
  merged: number;
  /** Of those, sent to a person. */
  queued: number;
}

/**
 * Take one pending record as far as the Register's answer allows.
 *
 * Split out from the loop so a single record can be driven through this in a
 * test without a scheduler or a clock.
 */
export async function settleOneNumber(
  referenceId: string,
  options: { allowAI?: boolean } = {},
): Promise<
  | { outcome: "unreachable" }
  | { outcome: "still_waiting" }
  | { outcome: "never_numbered" }
  | { outcome: "confirmed"; masterReferenceId: string }
  | { outcome: "merged"; into: string }
  | { outcome: "queued"; against: string }
  | { outcome: "collision_unresolved"; against: string }
> {
  const record = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, masterReferenceId: true, title: true, signedDate: true },
  });
  if (!record?.signedDate) return { outcome: "still_waiting" };

  const documents = await askTheRegister(record.signedDate);
  if (documents === null) return { outcome: "unreachable" };

  const asked = new Date();
  const match = findInRegister(record.title, documents);

  if (!match) {
    await prisma.governmentReference.update({
      where: { id: record.id },
      data: { numberAskedAt: asked },
    });
    return { outcome: "still_waiting" };
  }

  /*
   * The Register's own facts, now that it has them. The signing date is worth
   * taking: it is the authority on when the order was signed, and ours came
   * from when the White House happened to post it.
   */
  const correction = {
    numberAskedAt: asked,
    ...(match.signing_date ? { signedDate: new Date(`${match.signing_date}T00:00:00.000Z`) } : {}),
  };

  if (!match.executive_order_number) {
    await prisma.governmentReference.update({
      where: { id: record.id },
      data: {
        ...correction,
        numberStatus: NumberStatus.NEVER_NUMBERED,
        numberConfirmedAt: asked,
      },
    });
    console.log(
      `[EONumber] ${record.masterReferenceId} — the Register published this as ` +
        `"${match.subtype ?? "an unnumbered presidential document"}" with no order number. ` +
        `That is the answer; it will not be asked again.`,
    );
    return { outcome: "never_numbered" };
  }

  const realName = `eo-${match.executive_order_number}`;

  const renamed = await prisma.$transaction(async (tx) => {
    const result = await renameReference(tx, record.id, realName, NameSource.RENUMBERED);
    if (result.ok) {
      await tx.governmentReference.update({
        where: { id: record.id },
        data: {
          ...correction,
          numberStatus: NumberStatus.CONFIRMED,
          numberConfirmedAt: asked,
          ...(match.html_url ? { sourceUrl: match.html_url } : {}),
        },
      });
    }
    return result;
  });

  if (renamed.ok) {
    console.log(`[EONumber] ${record.masterReferenceId} is ${realName} — "${record.title}"`);
    return { outcome: "confirmed", masterReferenceId: realName };
  }

  // ---- The name is already held. Two records, one order number. ----

  const otherId = renamed.heldBy.referenceId;
  console.warn(
    `[EONumber] ${record.masterReferenceId} should be ${realName}, which ${otherId} already holds — adjudicating`,
  );

  // Asked and answered already? Do not pay a model to re-decide a pair that is
  // sitting in front of a reviewer.
  const pair = [record.id, otherId].sort();
  const filed = await prisma.referenceMergeCandidate.findUnique({
    where: { leftId_rightId: { leftId: pair[0]!, rightId: pair[1]! } },
    select: { status: true },
  });
  if (filed && filed.status === CandidateStatus.PENDING) {
    await prisma.governmentReference.update({
      where: { id: record.id },
      data: { numberAskedAt: asked },
    });
    return { outcome: "queued", against: otherId };
  }

  const mine = await recordFor(record.id);
  const theirs = await recordFor(otherId);
  if (!mine || !theirs) return { outcome: "collision_unresolved", against: otherId };

  const verdict = await adjudicate(mine, theirs, options);

  if (verdict.verdict === "same") {
    /*
     * THE RECORD THAT ALREADY HOLDS THE REAL NUMBER IS THE ONE THAT SURVIVES.
     *
     * Not a preference — the alternative does not work. masterReferenceId is
     * unique across the table and a merged-away record keeps its own, so the
     * survivor could never adopt "eo-14424" while the row it was merged from
     * still sits there holding it. Merging into the record that is already
     * correctly named needs no rename at all.
     *
     * Nothing is lost by this. mergeReferences moves the votes, the posts, the
     * positions and the roll calls onto the target atomically and journals the
     * whole thing, so which row survives changes no public number.
     */
    await mergeReferences(record.id, otherId);

    await fileCandidate({
      aId: record.id,
      bId: otherId,
      relationship: "same_executive_order",
      // Null on purpose: identifiedBy means an official analyst signed the
      // claim, the way congress.gov names one on an "Identical bill". Nobody
      // signed this — we worked it out — and writing our own reasoning into
      // that field would dress a machine's opinion as the government's.
      identifiedBy: null,
      evidenceUrl: match.html_url ?? undefined,
    });
    await prisma.referenceMergeCandidate.updateMany({
      where: { leftId: pair[0]!, rightId: pair[1]! },
      data: {
        status: CandidateStatus.APPROVED,
        decidedAt: new Date(),
        note: `Merged automatically: ${verdict.reason}`,
      },
    });

    await prisma.governmentReference.update({
      where: { id: otherId },
      data: {
        numberStatus: NumberStatus.CONFIRMED,
        numberConfirmedAt: asked,
        numberAskedAt: asked,
      },
    });

    console.log(
      `[EONumber] ${record.masterReferenceId} and ${theirs.masterReferenceId} are one order — ` +
        `folded into ${realName}`,
    );
    return { outcome: "merged", into: otherId };
  }

  if (verdict.verdict === "different") {
    // Both cannot be that number, and the Register says ours is. Left alone
    // rather than guessed at: renaming on top of a record that a person may
    // have voted on is not something to do on an inference.
    console.warn(
      `[EONumber] ${record.masterReferenceId} and ${theirs.masterReferenceId} both claim ${realName} ` +
        `but read as different orders: ${verdict.reason}`,
    );
  }

  await fileCandidate({
    aId: record.id,
    bId: otherId,
    relationship: "same_executive_order_number",
    identifiedBy: null,
    evidenceUrl: match.html_url ?? undefined,
    similarity: titleCloseness(mine.title, theirs.title),
  });
  await prisma.governmentReference.update({
    where: { id: record.id },
    data: { numberAskedAt: asked },
  });
  return { outcome: "queued", against: otherId };
}

/**
 * Every order still waiting on a number, once a day.
 */
export async function settleOutstandingNumbers(
  options: { now?: Date; allowAI?: boolean } = {},
): Promise<NumberingReport> {
  const now = options.now ?? new Date();
  const report: NumberingReport = {
    asked: 0,
    confirmed: 0,
    neverNumbered: 0,
    stillWaiting: 0,
    unreachable: 0,
    collided: 0,
    merged: 0,
    queued: 0,
  };

  const waiting = await prisma.governmentReference.findMany({
    where: {
      numberStatus: NumberStatus.PENDING,
      mergedIntoId: null,
      signedDate: { lte: daysBefore(now, FIRST_ASK_AFTER_DAYS) },
    },
    orderBy: { signedDate: "asc" },
    select: { id: true, masterReferenceId: true },
  });

  for (const record of waiting) {
    report.asked++;
    const result = await settleOneNumber(record.id, { allowAI: options.allowAI });
    switch (result.outcome) {
      case "unreachable":
        report.unreachable++;
        break;
      case "still_waiting":
        report.stillWaiting++;
        break;
      case "never_numbered":
        report.neverNumbered++;
        break;
      case "confirmed":
        report.confirmed++;
        break;
      case "merged":
        report.collided++;
        report.merged++;
        break;
      case "queued":
        report.collided++;
        report.queued++;
        break;
      case "collision_unresolved":
        report.collided++;
        break;
    }

    /*
     * One unreachable answer is a blip; several in a row is the Register being
     * down, and hammering it for every pending record helps nobody. The shelf
     * is small — a median of two records — so stopping early costs a day at
     * most.
     */
    if (report.unreachable >= 3) {
      console.warn("[EONumber] the Federal Register is not answering — stopping for today");
      break;
    }
  }

  return report;
}
