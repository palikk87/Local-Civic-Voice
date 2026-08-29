/**
 * The matchmaker: finding the records that are really one law.
 *
 * Congress files the same law twice as a matter of routine — a House bill and
 * its Senate companion, a measure reintroduced after it died in committee, a
 * bill whose text gets folded into an appropriations act. Each filing becomes a
 * record here, and until they are joined, the country's opinion on that law is
 * split across two counts and neither one is true.
 *
 * WHERE THE EVIDENCE COMES FROM
 *
 * Congress.gov publishes, for every bill, which other bills it is related to
 * and how, and — crucially — who made that call: the House, the Senate, or the
 * Congressional Research Service. The labels are the government's own:
 *
 *   "Identical bill"                 the two texts are the same
 *   "Companion measure"              filed in the other chamber to move in parallel
 *   "Procedurally related"           linked by a rule or a motion, not by text
 *   "Public law contains the text"   these words were enacted inside another law
 *   "Related bill"                   a different law on the same subject
 *
 * Those strings are taken from recorded responses in tests/fixtures/congress/,
 * not from the documentation. Getting one wrong is silent — an unrecognised
 * label is skipped, the relationship never reaches the queue, and nothing says
 * why. "Procedurally-related" with a hyphen was exactly that mistake.
 *
 * ONLY "IDENTICAL BILL" IS ACTED ON WITHOUT A PERSON
 *
 * That label means a Library of Congress analyst read both texts and confirmed
 * they match. Nothing this code could compute comes close to that, so nothing
 * this code computes is allowed to merge on its own.
 *
 * "Related bill" is never even offered as a candidate. Related means a
 * different law on the same subject — merging those would destroy two real
 * positions to produce one false one.
 *
 * WHY THERE IS A LOOK-ALIKE LIST AT ALL
 *
 * A load test against the live records found 7 of 13 stored bills have no
 * published lineage whatsoever, including two Venezuela bills with nearly
 * identical titles. Waiting for the government to link those means waiting
 * forever. So near-matching titles are offered as suggestions — marked as
 * carrying no authority, with no source and no analyst behind them, and never
 * merged automatically under any circumstances.
 *
 * WHAT THIS SERVICE WILL NOT DO
 *
 * It will not create a record for a related bill that is not already stored
 * here. A bill nobody on this platform has ever shared is not splitting anybody's
 * vote, and pulling in every relative of every record would fill the database
 * with laws no one asked about.
 */

import { prisma } from "../prisma";
import { mergeReferences } from "./deduplication-service";
import {
  adjudicate,
  recordFor,
  AI_MERGE_CONFIDENCE,
} from "./merge-adjudicator";
import { ReferenceKind, billReferenceId, parseReferenceId } from "./master-reference-id";
import { findByName } from "./reference-names";
import { congressGovKey, env } from "../env";

/**
 * The government's labels, spelled the way congress.gov actually returns them.
 *
 * Taken from recorded responses, not from the documentation. "Procedurally
 * related" has no hyphen in the payload even though it is written with one
 * nearly everywhere else — a mismatch here is silent, because an unrecognised
 * label is simply skipped, so the relationship never reaches the queue and
 * nothing anywhere says why. tests/fixtures/congress/ is what keeps this
 * honest.
 */
export const Relationship = {
  IDENTICAL: "Identical bill",
  COMPANION: "Companion measure",
  PROCEDURAL: "Procedurally related",
  /**
   * The bill's text was enacted inside a public law. Not the same filing, but
   * the same words carrying the same legal force, which is exactly the kind of
   * call a person should make and a machine should not.
   */
  ENACTED_INSIDE: "Public law contains the text",
  RELATED: "Related bill",
} as const;

/**
 * A title match this platform computed. Deliberately not spelled like one of
 * the government's labels, so nothing downstream can mistake it for one.
 */
export const LOOK_ALIKE = "look_alike";

export const CandidateStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  /** The pair stopped being two records — one of them was merged elsewhere. */
  SUPERSEDED: "superseded",
} as const;

/**
 * Relationships that are worth a human's attention.
 *
 * "Related bill" is absent on purpose and is the single most important
 * exclusion in this file.
 */
const REVIEWABLE: ReadonlySet<string> = new Set([
  Relationship.IDENTICAL,
  Relationship.COMPANION,
  Relationship.PROCEDURAL,
  // Kept alongside the unhyphenated spelling congress.gov actually returns,
  // because a label this code fails to recognise fails silently.
  "Procedurally-related",
  Relationship.ENACTED_INSIDE,
]);

/** How alike two titles must be before the pair is worth suggesting. */
const LOOK_ALIKE_THRESHOLD = 0.9;

/** Cap on how many look-alike suggestions one sweep will file. */
const LOOK_ALIKE_LIMIT = 25;

const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// congress.gov
// ---------------------------------------------------------------------------

interface RelatedBillsResponse {
  relatedBills?: Array<{
    congress?: number;
    type?: string;
    number?: string | number;
    title?: string;
    relationshipDetails?: Array<{ type?: string; identifiedBy?: string }>;
  }>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[Lineage] ${url.split("?")[0]} -> ${response.status}`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error(
      `[Lineage] fetch failed for ${url.split("?")[0]}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

const CHAMBER_SLUGS: Record<string, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
  hres: "house-resolution",
  sres: "senate-resolution",
};

function ordinal(n: number): string {
  const rem = n % 10;
  const suffix =
    rem === 1 && n % 100 !== 11
      ? "st"
      : rem === 2 && n % 100 !== 12
        ? "nd"
        : rem === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

/**
 * The page a reviewer opens to check the claim for themselves.
 *
 * Deliberately the human congress.gov page and not the JSON endpoint: the point
 * of attaching evidence is that a person can read it, and an API URL with a key
 * in it is neither readable nor safe to put on a screen.
 */
export function relatedBillsPageFor(congress: number, type: string, number: string): string {
  const slug = CHAMBER_SLUGS[type.toLowerCase()] ?? "house-bill";
  return `https://www.congress.gov/bill/${ordinal(congress)}-congress/${slug}/${number}/related-bills`;
}

export interface PublishedRelationship {
  masterReferenceId: string;
  relationship: string;
  identifiedBy: string | null;
  title: string | null;
}

/**
 * What the government says this bill is related to.
 *
 * Returns an empty list when there is no key, no answer, or no lineage. A
 * missing relationship is a fact about the government's records, not a failure
 * worth escalating — 7 of 13 stored bills have none.
 */
export async function publishedRelationshipsFor(
  masterReferenceId: string,
  apiKey = congressGovKey(),
): Promise<PublishedRelationship[]> {
  if (!apiKey) return [];

  const key = parseReferenceId(ReferenceKind.BILL, masterReferenceId);
  if (key?.kind !== "bill" || key.congress === null) return [];

  const url =
    `https://api.congress.gov/v3/bill/${key.congress}/${key.billType}/${key.number}` +
    `/relatedbills?format=json&limit=250&api_key=${apiKey}`;

  const data = await fetchJson<RelatedBillsResponse>(url);
  if (!data?.relatedBills) return [];

  const found: PublishedRelationship[] = [];

  for (const related of data.relatedBills) {
    if (!related.type || related.number === undefined || !related.congress) continue;

    const otherName = billReferenceId({
      type: related.type,
      number: related.number,
      congress: related.congress,
    });
    if (!otherName) continue;

    // One pair can carry several labels — the House and the Senate can each
    // have their own view. Every one is kept; the caller decides which matters.
    for (const detail of related.relationshipDetails ?? []) {
      if (!detail.type) continue;
      found.push({
        masterReferenceId: otherName,
        relationship: detail.type,
        identifiedBy: detail.identifiedBy ?? null,
        title: related.title ?? null,
      });
    }
  }

  return found;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/**
 * Two ids in a fixed order.
 *
 * The unique constraint on the pair is worthless unless A-B and B-A produce the
 * same row, which is how a review queue ends up asking the same question twice.
 */
function orderPair(a: string, b: string): { leftId: string; rightId: string } {
  return a < b ? { leftId: a, rightId: b } : { leftId: b, rightId: a };
}

export interface FileCandidateInput {
  aId: string;
  bId: string;
  relationship: string;
  identifiedBy?: string | null;
  evidenceUrl?: string | null;
  similarity?: number | null;
}

/**
 * Put a pair in front of a reviewer, once.
 *
 * A pair somebody has already answered is never re-filed. Re-asking a rejected
 * question every night is how a review queue becomes something people stop
 * reading, and a reviewer's "no" is a decision, not a temporary state.
 */
export async function fileCandidate(
  input: FileCandidateInput,
  /**
   * The client to write through. Defaults to the shared one; taking it as a
   * parameter is what lets the filing rules be exercised against a database
   * without standing a server up in front of them.
   */
  db: Pick<typeof prisma, "referenceMergeCandidate"> = prisma,
): Promise<{ filed: boolean; reason?: string }> {
  if (input.aId === input.bId) return { filed: false, reason: "same record" };

  const pair = orderPair(input.aId, input.bId);

  const existing = await db.referenceMergeCandidate.findUnique({
    where: { leftId_rightId: pair },
    select: { id: true, status: true, relationship: true },
  });

  if (existing) {
    // One exception to "never re-file": a pair somebody declined as a
    // look-alike guess deserves to be asked again when the government
    // subsequently publishes a real relationship for it. That is new evidence,
    // not the same question.
    const upgradeFromGuess =
      existing.relationship === LOOK_ALIKE && input.relationship !== LOOK_ALIKE;

    if (existing.status !== CandidateStatus.PENDING && !upgradeFromGuess) {
      return { filed: false, reason: `already ${existing.status}` };
    }

    await db.referenceMergeCandidate.update({
      where: { id: existing.id },
      data: {
        relationship: input.relationship,
        identifiedBy: input.identifiedBy ?? null,
        evidenceUrl: input.evidenceUrl ?? null,
        similarity: input.similarity ?? null,
        ...(upgradeFromGuess
          ? { status: CandidateStatus.PENDING, decidedById: null, decidedAt: null, note: null }
          : {}),
      },
    });
    return { filed: true };
  }

  await db.referenceMergeCandidate.create({
    data: {
      ...pair,
      relationship: input.relationship,
      identifiedBy: input.identifiedBy ?? null,
      evidenceUrl: input.evidenceUrl ?? null,
      similarity: input.similarity ?? null,
    },
  });
  return { filed: true };
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

export interface LineageResult {
  checked: number;
  merged: number;
  queued: number;
  noLineage: number;
  skipped: number;
}

/**
 * Which of two records should survive a merge.
 *
 * The one with more real engagement, so the merge moves as little as possible
 * and the surviving record is the one people are already looking at. Ties go to
 * the older record, which is the one more links point at.
 */
async function pickSurvivor(
  aId: string,
  bId: string,
): Promise<{ targetId: string; sourceId: string } | null> {
  const rows = await prisma.governmentReference.findMany({
    where: { id: { in: [aId, bId] }, mergedIntoId: null },
    select: {
      id: true,
      createdAt: true,
      citizenBrief: true,
      _count: { select: { posts: true, votes: true } },
    },
  });
  if (rows.length !== 2) return null;

  const score = (r: (typeof rows)[number]) =>
    r._count.votes * 10 + r._count.posts * 5 + (r.citizenBrief ? 1 : 0);

  const [first, second] = rows as [(typeof rows)[number], (typeof rows)[number]];
  const firstWins =
    score(first) !== score(second)
      ? score(first) > score(second)
      : first.createdAt <= second.createdAt;

  return firstWins
    ? { targetId: first.id, sourceId: second.id }
    : { targetId: second.id, sourceId: first.id };
}

/**
 * Check one record's lineage against congress.gov and act on it.
 *
 * Auto-merges only on "Identical bill". Everything else reviewable goes to the
 * queue. Both records must already exist here — a bill nobody has shared is not
 * splitting anybody's vote.
 */
export async function syncLineageFor(referenceId: string): Promise<LineageResult> {
  const result: LineageResult = { checked: 1, merged: 0, queued: 0, noLineage: 0, skipped: 0 };

  const record = await prisma.governmentReference.findUnique({
    where: { id: referenceId },
    select: { id: true, masterReferenceId: true, referenceType: true, mergedIntoId: true },
  });

  if (!record || record.referenceType !== "bill" || record.mergedIntoId) {
    result.skipped = 1;
    return result;
  }

  const key = parseReferenceId(ReferenceKind.BILL, record.masterReferenceId);
  if (key?.kind !== "bill" || key.congress === null) {
    result.skipped = 1;
    return result;
  }

  const published = await publishedRelationshipsFor(record.masterReferenceId);
  if (published.length === 0) {
    result.noLineage = 1;
    return result;
  }

  const evidenceUrl = relatedBillsPageFor(key.congress, key.billType, key.number);

  for (const relation of published) {
    if (relation.relationship === Relationship.RELATED) continue;
    if (!REVIEWABLE.has(relation.relationship)) continue;

    // Only records this platform already holds. The registry is the lookup,
    // so a bill stored under a former name is still found.
    const other = await findByName(relation.masterReferenceId);
    if (!other || other.referenceId === record.id) continue;

    const stillSeparate = await prisma.governmentReference.findUnique({
      where: { id: other.referenceId },
      select: { mergedIntoId: true },
    });
    if (!stillSeparate || stillSeparate.mergedIntoId) continue;

    // "Identical bill" is the only label a machine may act on: it means a
    // Library of Congress analyst read both texts and confirmed they match.
    // identifiedBy has to be present — an identical claim nobody signed is not
    // the thing that earns this trust.
    if (relation.relationship === Relationship.IDENTICAL && relation.identifiedBy) {
      const roles = await pickSurvivor(record.id, other.referenceId);
      if (!roles) continue;

      await mergeReferences(roles.sourceId, roles.targetId);
      await fileCandidate({
        aId: record.id,
        bId: other.referenceId,
        relationship: relation.relationship,
        identifiedBy: relation.identifiedBy,
        evidenceUrl,
      });
      await prisma.referenceMergeCandidate.update({
        where: { leftId_rightId: orderPair(record.id, other.referenceId) },
        data: {
          status: CandidateStatus.APPROVED,
          decidedAt: new Date(),
          note: `Merged automatically: congress.gov records these as identical, identified by ${relation.identifiedBy}.`,
        },
      });
      result.merged += 1;
      console.log(
        `[Lineage] ${record.masterReferenceId} = ${relation.masterReferenceId} ` +
          `("${relation.relationship}", identified by ${relation.identifiedBy}) — merged`,
      );
      continue;
    }

    const filed = await fileCandidate({
      aId: record.id,
      bId: other.referenceId,
      relationship: relation.relationship,
      identifiedBy: relation.identifiedBy,
      evidenceUrl,
    });
    if (filed.filed) result.queued += 1;
  }

  return result;
}

/**
 * Suggest pairs whose titles are nearly the same and that the government has
 * not linked.
 *
 * A suggestion and nothing more. No source, no analyst, no authority — the
 * queue says so, and nothing here ever merges. It exists because a load test
 * found 7 of 13 stored bills with no published lineage at all, including two
 * Venezuela bills with nearly identical titles, and waiting for congress.gov to
 * link those means waiting forever.
 */
export async function suggestLookAlikes(): Promise<{ suggested: number; compared: number }> {
  const records = await prisma.governmentReference.findMany({
    where: { mergedIntoId: null },
    select: { id: true, referenceType: true, title: true, congress: true },
    orderBy: { createdAt: "asc" },
  });

  let suggested = 0;
  let compared = 0;

  for (let i = 0; i < records.length && suggested < LOOK_ALIKE_LIMIT; i++) {
    for (let j = i + 1; j < records.length && suggested < LOOK_ALIKE_LIMIT; j++) {
      const a = records[i]!;
      const b = records[j]!;

      // A bill is never a look-alike of an executive order, whatever the
      // titles say.
      if (a.referenceType !== b.referenceType) continue;

      compared += 1;
      const similarity = titleSimilarity(a.title, b.title);
      if (similarity < LOOK_ALIKE_THRESHOLD) continue;

      const filed = await fileCandidate({
        aId: a.id,
        bId: b.id,
        relationship: LOOK_ALIKE,
        similarity,
      });
      if (filed.filed) suggested += 1;
    }
  }

  return { suggested, compared };
}

/**
 * How alike two titles are, 0 to 1.
 *
 * Token overlap rather than edit distance. Congressional titles are long and
 * formulaic — "A bill to amend title 38, United States Code, to..." — so edit
 * distance scores nearly every pair as similar on boilerplate alone. Comparing
 * the meaningful words instead is what tells two Venezuela bills apart from two
 * unrelated veterans bills.
 */
export function titleSimilarity(a: string, b: string): number {
  const words = (t: string) =>
    new Set(
      t
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !TITLE_STOPWORDS.has(w)),
    );

  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;

  // Jaccard: shared over the union, so a short title inside a long one does not
  // score as a match.
  return shared / (left.size + right.size - shared);
}

const TITLE_STOPWORDS = new Set([
  "the", "and", "for", "act", "bill", "resolution", "amendment", "united", "states",
  "code", "title", "section", "purposes", "other", "amend", "provide", "relating",
  "establish", "authorize", "with", "respect", "from", "into", "under", "that",
  "this", "shall", "such", "any", "all", "certain",
]);

/**
 * Sweep every stored bill for lineage, then offer look-alikes for the rest.
 *
 * Paced, because congress.gov is one request per record and a signed key allows
 * 1,000 an hour. A sweep that burns the budget leaves the search that shares the
 * key with nothing.
 */
export async function syncAllLineage(limit = 50): Promise<LineageResult & { suggested: number }> {
  const bills = await prisma.governmentReference.findMany({
    where: { referenceType: "bill", mergedIntoId: null },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const totals: LineageResult = { checked: 0, merged: 0, queued: 0, noLineage: 0, skipped: 0 };

  for (const bill of bills) {
    // A record merged earlier in this same sweep is no longer its own record.
    const still = await prisma.governmentReference.findUnique({
      where: { id: bill.id },
      select: { mergedIntoId: true },
    });
    if (!still || still.mergedIntoId) {
      totals.skipped += 1;
      continue;
    }

    const one = await syncLineageFor(bill.id);
    totals.checked += one.checked;
    totals.merged += one.merged;
    totals.queued += one.queued;
    totals.noLineage += one.noLineage;
    totals.skipped += one.skipped;
  }

  const { suggested } = await suggestLookAlikes();

  console.log(
    `[Lineage] swept ${totals.checked} bill(s): ${totals.merged} merged, ${totals.queued} queued, ` +
      `${totals.noLineage} with no published lineage, ${totals.skipped} skipped; ` +
      `${suggested} look-alike suggestion(s)`,
  );

  return { ...totals, suggested };
}

/**
 * Close out candidates whose pair stopped being two records.
 *
 * A queue that shows questions which can no longer be answered is a queue
 * people stop trusting.
 */
export async function retireStaleCandidates(): Promise<number> {
  const pending = await prisma.referenceMergeCandidate.findMany({
    where: { status: CandidateStatus.PENDING },
    select: {
      id: true,
      left: { select: { mergedIntoId: true } },
      right: { select: { mergedIntoId: true } },
    },
  });

  const stale = pending
    .filter((c) => c.left.mergedIntoId !== null || c.right.mergedIntoId !== null)
    .map((c) => c.id);

  if (stale.length === 0) return 0;

  await prisma.referenceMergeCandidate.updateMany({
    where: { id: { in: stale } },
    data: {
      status: CandidateStatus.SUPERSEDED,
      decidedAt: new Date(),
      note: "One of these records has since been merged elsewhere.",
    },
  });

  return stale.length;
}

export interface AdjudicationSweep {
  considered: number;
  merged: number;
  rejected: number;
  leftPending: number;
}

/**
 * Work the queue automatically, so it stops being a queue.
 *
 * WHY THIS EXISTS. A pending candidate is two records for one law, each
 * publishing its own vote count, neither of them the number. Waiting for an
 * administrator to notice means publishing two half-answers for as long as
 * nobody looks — and nobody looks. The review queue was the right design while
 * a merge could not be undone; it can be undone now, so the decision can be
 * made here and corrected if it is wrong.
 *
 * WHAT IT REFUSES TO DO. Merge on resemblance. A look-alike is a title
 * similarity this platform computed and nobody official stands behind, and the
 * load test behind this system found exactly why that is not enough: three DHS
 * appropriations bills with twenty-six published relationships between them
 * and no identical label, and two Venezuela bills with nearly the same title
 * that are different laws. Those pairs go to the adjudicator like any other,
 * and the adjudicator is written to answer "different" when they are.
 *
 * Every merge it makes is journalled with the tier that decided, the reason in
 * words and the model's confidence where a model was involved.
 */
export async function adjudicatePending(
  limit = 25,
  options: { allowAI?: boolean } = {},
): Promise<AdjudicationSweep> {
  const pending = await prisma.referenceMergeCandidate.findMany({
    // decidedAt is set on a still-pending row when a model has already read
    // this pair and could not tell. Without that filter the sweep pays to ask
    // the same unanswerable question about the same two bills every six hours
    // for as long as the platform runs, and the oldest-first ordering means
    // those pairs also block every newer candidate from ever being looked at.
    where: { status: CandidateStatus.PENDING, decidedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const sweep: AdjudicationSweep = {
    considered: 0,
    merged: 0,
    rejected: 0,
    leftPending: 0,
  };

  for (const candidate of pending) {
    const [left, right] = await Promise.all([
      recordFor(candidate.leftId),
      recordFor(candidate.rightId),
    ]);
    if (!left || !right) continue;

    sweep.considered += 1;

    const verdict = await adjudicate(left, right, options);

    if (verdict.verdict === "same" && verdict.confidence >= AI_MERGE_CONFIDENCE) {
      const roles = await pickSurvivor(left.id, right.id);
      if (!roles) {
        // Nothing about the pair will change on the next sweep, so stamping it
        // stops the model being paid to re-confirm a merge that cannot happen.
        await prisma.referenceMergeCandidate.update({
          where: { id: candidate.id },
          data: {
            decidedAt: new Date(),
            note:
              `Ruled the same measure (${verdict.basis}) but neither record could be ` +
              `chosen to survive. Needs a person.`,
          },
        });
        sweep.leftPending += 1;
        continue;
      }

      await mergeReferences(roles.sourceId, roles.targetId, {
        decidedBy: verdict.basis,
        reason: verdict.reason,
        evidenceUrl: candidate.evidenceUrl,
        confidence: verdict.confidence,
      });

      await prisma.referenceMergeCandidate.update({
        where: { id: candidate.id },
        data: {
          status: CandidateStatus.APPROVED,
          decidedAt: new Date(),
          note: `Merged automatically (${verdict.basis}): ${verdict.reason}`,
        },
      });

      sweep.merged += 1;
      console.log(
        `[Adjudicator] ${left.masterReferenceId} = ${right.masterReferenceId} ` +
          `(${verdict.basis}, confidence ${verdict.confidence}) — merged`,
      );
      continue;
    }

    if (verdict.verdict === "different") {
      // Written down so the same pair is not re-litigated every sweep, and so
      // a person reading the queue later can see what was decided and why.
      await prisma.referenceMergeCandidate.update({
        where: { id: candidate.id },
        data: {
          status: CandidateStatus.REJECTED,
          decidedAt: new Date(),
          note: `Not the same measure (${verdict.basis}): ${verdict.reason}`,
        },
      });
      sweep.rejected += 1;
      continue;
    }

    // "Unsure", or a confident-enough model that was not confident enough.
    // Left where it is: an honest maybe is the one case a person is still
    // better at than this.
    //
    // If a model actually answered, that is written down and the pair is not
    // put to a model again — the answer will not change, and asking again
    // every six hours is money spent on a question already asked. A model that
    // could not be REACHED is left unstamped, because that is worth retrying.
    if (verdict.basis === "ai_adjudicated" || verdict.basis === "ai_unreadable") {
      await prisma.referenceMergeCandidate.update({
        where: { id: candidate.id },
        data: {
          decidedAt: new Date(),
          note: `A model read both and could not decide (${verdict.basis}): ${verdict.reason}`,
        },
      });
    }
    sweep.leftPending += 1;
  }

  console.log(
    `[Adjudicator] considered ${sweep.considered}: ${sweep.merged} merged, ` +
      `${sweep.rejected} ruled different, ${sweep.leftPending} still open`,
  );

  return sweep;
}
