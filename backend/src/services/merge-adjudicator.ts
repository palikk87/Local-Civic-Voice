/**
 * Deciding, without an admin, whether two records are one law.
 *
 * WHY THIS REPLACED A REVIEW QUEUE. Duplicates split the Pulse: two records
 * for one bill means two vote counts, and neither is the number. A queue that
 * needs a human is a queue that sits, and every day it sits the platform
 * publishes two half-answers about the same law. The queue was the right call
 * while a merge could not be undone. It can be undone now, so the decision can
 * be made by a machine and corrected if it is wrong.
 *
 * WHAT IT WILL AND WILL NOT ACT ON. Not resemblance. The load test behind this
 * system found three DHS appropriations bills with twenty-six published
 * relationships between them and no identical label — separate bills that must
 * never merge — and two Venezuela bills with nearly the same title that are
 * different laws. A title is a suggestion, and this refuses to merge on one.
 *
 * The tiers, strongest first:
 *
 *   1. PROOF, no model involved.
 *      - congress.gov says "Identical bill", signed by a named analyst.
 *      - The two official texts are the same. Two records holding the same
 *        text are the same measure; that is a fact, not an inference.
 *
 *   2. JUDGEMENT, a model reads both and says so.
 *      Only for pairs the government has already linked, or that share a
 *      number and a congress. The model gets the texts and has to answer with
 *      a verdict, a confidence and a reason. Merges only on "same" above a
 *      high bar, and only when the structural facts agree.
 *
 *   3. NOTHING. Everything else is left alone, which is most things.
 *
 * Every automatic merge is journalled with the tier, the reason and — where a
 * model decided — its confidence and its words, so a wrong one can be found
 * and undone.
 */

import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { generateAI } from "./ai-generate";

export type Verdict = "same" | "different" | "unsure";

export interface Adjudication {
  verdict: Verdict;
  /** 0 to 1. Only meaningful on a model's answer. */
  confidence: number;
  /** Which tier decided: "same_text", "ai_adjudicated", or "no_evidence". */
  basis: string;
  reason: string;
}

/** Below this a model's "same" is not acted on. */
export const AI_MERGE_CONFIDENCE = 0.9;

/** Official text long enough to be worth comparing at all. */
const MINIMUM_TEXT_LENGTH = 400;

/**
 * Normalised so two copies of one law compare equal.
 *
 * Whitespace, case and the punctuation that differs between a congress.gov
 * HTML rendering and a plain-text one carry no meaning here. Everything else
 * is left alone: two texts that differ by a word are two versions, and this
 * must not smooth that away.
 */
export function textFingerprint(text: string): string {
  const normalised = text
    .replace(/<[^>]+>/g, " ")
    // congress.gov's HTML rendering of a bill is full of these and the plain
    // text rendering of the same bill is not. Left encoded, one law fetched
    // two ways fingerprints as two different laws.
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;|&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#39;|&apos;|&#8217;|&rsquo;/gi, "'")
    .replace(/&mdash;|&#8212;/gi, "-")
    // Anything else encoded becomes a space rather than surviving as markup.
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\s ]+/g, " ")
    .trim()
    .toLowerCase();

  return createHash("sha256").update(normalised).digest("hex");
}

export interface RecordForAdjudication {
  id: string;
  masterReferenceId: string;
  title: string;
  referenceType: string;
  congress: number | null;
  chamber: string | null;
  fullText: string | null;
  description: string | null;
}

/**
 * Tier 1: are these two the same text?
 *
 * Objective and cheap. A record whose text has not been fetched cannot answer,
 * and says so rather than guessing.
 */
export function sameText(a: RecordForAdjudication, b: RecordForAdjudication): Adjudication | null {
  if (!a.fullText || !b.fullText) return null;
  if (a.fullText.length < MINIMUM_TEXT_LENGTH || b.fullText.length < MINIMUM_TEXT_LENGTH) {
    // A stub or an error page is not a law. Comparing them would find matches
    // that mean nothing.
    return null;
  }

  if (textFingerprint(a.fullText) !== textFingerprint(b.fullText)) return null;

  return {
    verdict: "same",
    confidence: 1,
    basis: "same_text",
    reason:
      `The official text of ${a.masterReferenceId} and ${b.masterReferenceId} is identical, ` +
      `character for character once formatting is normalised.`,
  };
}

/**
 * Tier 2: a model reads both and decides.
 *
 * The prompt is written to make "different" the easy answer. A model asked
 * whether two things are similar will say yes; asked whether two bills are THE
 * SAME BILL, with the failure modes named, it will not.
 */
export async function adjudicateWithAI(
  a: RecordForAdjudication,
  b: RecordForAdjudication,
): Promise<Adjudication> {
  const excerpt = (record: RecordForAdjudication) =>
    (record.fullText ?? record.description ?? "").slice(0, 6000) || "(no text available)";

  const prompt = [
    "You are deciding whether two congressional records are THE SAME MEASURE,",
    "so that a civic platform can combine them into one and pool the public's",
    "votes. Combining two different bills corrupts a public vote count, so the",
    "cost of a wrong 'same' is far higher than the cost of a wrong 'different'.",
    "",
    "Answer 'same' ONLY if these are two records of one measure — for example a",
    "House bill and its identical Senate companion, or the same bill recorded",
    "twice under different spellings of its number.",
    "",
    "Answer 'different' if they are separate measures, even when they are",
    "closely related. These are all DIFFERENT:",
    "  - two appropriations bills for the same agency in different years",
    "  - a bill and an amendment to it",
    "  - two bills on the same subject with similar titles",
    "  - a bill and a resolution about the same topic",
    "",
    "Answer 'unsure' if the text given is not enough to tell.",
    "",
    `RECORD A — ${a.masterReferenceId} (${a.referenceType}, congress ${a.congress ?? "unknown"})`,
    `Title: ${a.title}`,
    `Text: ${excerpt(a)}`,
    "",
    `RECORD B — ${b.masterReferenceId} (${b.referenceType}, congress ${b.congress ?? "unknown"})`,
    `Title: ${b.title}`,
    `Text: ${excerpt(b)}`,
    "",
    'Reply with JSON only: {"verdict":"same|different|unsure","confidence":0.0-1.0,"reason":"one or two sentences"}',
  ].join("\n");

  const result = await generateAI({
    prompt,
    jsonMode: true,
    // A verdict, a number and a sentence. This does not need room to
    // deliberate at length, and every token offered is one it may spend.
    maxCompletionTokens: 400,
    reasoningHeadroom: 1_000,
    // This runs in a background sync, but a model that has not answered in a
    // minute has not answered.
    timeoutMs: 60_000,
  });
  if (!result.ok) {
    return {
      verdict: "unsure",
      confidence: 0,
      basis: "ai_unavailable",
      reason: `No model could be reached: ${result.error}`,
    };
  }

  try {
    const json = /\{[\s\S]*\}/.exec(result.content)?.[0];
    if (!json) throw new Error("no JSON in the reply");

    const parsed = JSON.parse(json) as {
      verdict?: string;
      confidence?: number;
      reason?: string;
    };

    const verdict: Verdict =
      parsed.verdict === "same" ? "same" : parsed.verdict === "different" ? "different" : "unsure";

    return {
      verdict,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      basis: "ai_adjudicated",
      reason: parsed.reason?.trim() || "The model gave no reason.",
    };
  } catch (error) {
    // A model that did not answer in the shape it was asked for is a model
    // that has not decided anything.
    return {
      verdict: "unsure",
      confidence: 0,
      basis: "ai_unreadable",
      reason: `The model's reply could not be read: ${String(error)}`,
    };
  }
}

/**
 * The structural facts a model is not allowed to overrule.
 *
 * A model can be talked into anything by two well-written bills. These are
 * checks on the record itself, and a "same" that fails one of them is refused
 * whatever the model said.
 */
export function structurallyMergeable(
  a: RecordForAdjudication,
  b: RecordForAdjudication,
): { ok: true } | { ok: false; why: string } {
  if (a.id === b.id) return { ok: false, why: "the same record twice" };

  if (a.referenceType !== b.referenceType) {
    return { ok: false, why: `a ${a.referenceType} is not a ${b.referenceType}` };
  }

  // Bills are numbered per Congress. H.R. 1 of the 118th and H.R. 1 of the
  // 119th share a number and nothing else.
  if (a.congress !== null && b.congress !== null && a.congress !== b.congress) {
    return { ok: false, why: `different congresses (${a.congress} and ${b.congress})` };
  }

  return { ok: true };
}

/**
 * The whole decision for one pair.
 *
 * Returns what should happen and why, without doing it — so the caller can log
 * it, act on it, or in the case of a queue review, show it to somebody.
 */
export async function adjudicate(
  a: RecordForAdjudication,
  b: RecordForAdjudication,
  options: { allowAI?: boolean } = {},
): Promise<Adjudication> {
  const structural = structurallyMergeable(a, b);
  if (!structural.ok) {
    return {
      verdict: "different",
      confidence: 1,
      basis: "structural",
      reason: `Cannot be one measure: ${structural.why}.`,
    };
  }

  const byText = sameText(a, b);
  if (byText) return byText;

  if (options.allowAI === false) {
    return {
      verdict: "unsure",
      confidence: 0,
      basis: "no_evidence",
      reason: "The texts do not match and no model was consulted.",
    };
  }

  return adjudicateWithAI(a, b);
}

/** Load the fields an adjudication needs. */
export async function recordFor(id: string): Promise<RecordForAdjudication | null> {
  return prisma.governmentReference.findUnique({
    where: { id },
    select: {
      id: true,
      masterReferenceId: true,
      title: true,
      referenceType: true,
      congress: true,
      chamber: true,
      fullText: true,
      description: true,
    },
  });
}
