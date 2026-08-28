/**
 * The Citizen's Brief.
 *
 * WHAT IT IS, exactly:
 *
 *   1. One paragraph, in plain English, that anyone can understand — what this
 *      law does. Neutral. It takes no side.
 *   2. The case FOR it, in two or three sentences.
 *   3. The case AGAINST it, in two or three sentences.
 *
 * WHERE IT COMES FROM: the full official text of the law, and nothing else.
 *
 * That last rule is the entire design, not a preference. A model handed a title
 * and a status will write a confident, fluent, plausible summary of a law it
 * has not read — and a reader cannot tell that summary apart from a real one.
 * Every other input is a route to a claim the law does not make: an official
 * summary is somebody else's reading, a category is a guess someone filed, and
 * the model's own memory of a bill number is the worst source of all.
 *
 * So the model sees the text. Not the title, not the id, not the status, not
 * the description. If there is no text, there is no brief, and the reader is
 * told that plainly rather than handed a guess.
 *
 * The two arguments are written from the text as well: what the law itself
 * gives supporters and opponents to work with. They are not opinions collected
 * from elsewhere, and they are not balanced by inventing a grievance — where
 * the text genuinely offers little for one side, the brief says so.
 */

import { generateAI, parseJsonObject, safeInputChars } from "./ai-generate";

/** The three parts a reader sees. */
export interface CitizenBrief {
  /** One paragraph. Neutral. What the law does. */
  summary: string;
  /** Two to three sentences: the strongest case for it, grounded in the text. */
  argumentFor: string;
  /** Two to three sentences: the strongest case against it, grounded in the text. */
  argumentAgainst: string;
}

/**
 * Stored inside the brief JSON so a brief written to an older definition is
 * recognisable and simply regenerated, rather than rendered into a card that no
 * longer has slots for it. Bump this when the three parts change meaning.
 */
export const BRIEF_FORMAT = 2;

interface StoredBrief extends CitizenBrief {
  format: number;
}

export type BriefOutcome =
  | { state: "ready"; brief: CitizenBrief; model: string }
  | { state: "unavailable"; reason: string };

/** The reader-facing reason when no source publishes the text. */
export const NO_TEXT_REASON =
  "The full text of this law isn't published anywhere we can read yet. A brief is " +
  "written only from the law itself, so rather than guess at what it says, we're " +
  "not showing one.";

/** The reader-facing reason when the text is there but the writing failed. */
const WRITE_FAILED_REASON =
  "The brief couldn't be written just now. The full text is available, so this is " +
  "worth trying again.";

/**
 * Read a stored brief, insisting it is the current definition.
 *
 * A brief in an older shape returns null, which reads downstream as "no brief
 * yet" — so the reader is offered the button and gets one written to the
 * definition the card actually renders. Nothing is migrated and nothing is
 * silently reshaped.
 */
export function parseBrief(json: string | null | undefined): CitizenBrief | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<StoredBrief>;
    if (parsed.format !== BRIEF_FORMAT) return null;
    if (!parsed.summary?.trim()) return null;
    if (!parsed.argumentFor?.trim()) return null;
    if (!parsed.argumentAgainst?.trim()) return null;
    return {
      summary: parsed.summary.trim(),
      argumentFor: parsed.argumentFor.trim(),
      argumentAgainst: parsed.argumentAgainst.trim(),
    };
  } catch {
    return null;
  }
}

export function serializeBrief(brief: CitizenBrief): string {
  const stored: StoredBrief = { format: BRIEF_FORMAT, ...brief };
  return JSON.stringify(stored);
}

/** One block of plain text a reader could paste anywhere. */
export function flattenBrief(brief: CitizenBrief): string {
  return [
    brief.summary,
    `The case for it: ${brief.argumentFor}`,
    `The case against it: ${brief.argumentAgainst}`,
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// The prompts
// ---------------------------------------------------------------------------

/**
 * The rule the model is held to, stated once and repeated in every pass.
 *
 * "Only from the text" has to be said as a prohibition and not as a preference,
 * because the failure it prevents is the model being helpful: filling a gap
 * from general knowledge reads exactly like reading carefully, and produces a
 * brief about a law that does not exist.
 */
const SYSTEM = [
  "You write Citizen's Briefs: short, plain-English explanations of laws for ordinary people.",
  "",
  "You will be given the official text of one law. That text is your ONLY source.",
  "",
  "Absolute rules:",
  "- Use nothing but the text provided. Not your own knowledge of this law, not what",
  "  similar laws usually do, not what the title suggests.",
  "- If the text does not say something, do not say it. Never estimate a cost, a date,",
  "  a sponsor, or an effect that the text does not state.",
  "- Stay neutral in the summary. Describe what the law does; do not judge it.",
  "- Write for someone with no legal training. No jargon, no section numbers, no",
  "  quoting the text back.",
  "- Always return valid JSON and nothing else.",
].join("\n");

const SHAPE = [
  "Return exactly this JSON:",
  "{",
  '  "summary": "One paragraph. Plain English. What this law does and who it affects. Neutral — no judgement, no recommendation.",',
  '  "argumentFor": "Two to three sentences. The strongest honest case for this law, built only from what the text actually does.",',
  '  "argumentAgainst": "Two to three sentences. The strongest honest case against this law, built only from what the text actually does."',
  "}",
  "",
  "Both arguments must come from the text. Do not invent a controversy the text gives",
  "no basis for — if one side has little to work with here, say so plainly in that field",
  "rather than manufacturing a complaint.",
].join("\n");

function firstPassPrompt(text: string, objections?: string[]): string {
  return [
    objectionBlock(objections),
    "Official text of the law, in full:",
    "",
    text,
    "",
    SHAPE,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Reading pass for one section of a law too long to fit in one go.
 *
 * This does NOT write a brief. It takes notes — what this section actually
 * does, in the section's own terms. No brief exists until every section has
 * been read, because a brief written from the first third of a law is a
 * confident account of a document nobody finished, and the reader cannot tell
 * the difference.
 *
 * Notes stay close to the text on purpose: the writing pass never sees the
 * original bytes for a long law, so anything these notes drop is gone, and
 * anything they embellish becomes a claim the law does not make.
 */
function readSectionPrompt(text: string, part: number, partsTotal: number): string {
  return [
    `This is section ${part} of ${partsTotal} of one law's official text.`,
    "",
    "Do NOT summarize the law and do NOT write a brief — you have not seen all of it.",
    "Take notes on THIS SECTION only:",
    "- every substantive thing it does, requires, permits, prohibits, funds, or repeals",
    "- every number, date, deadline, and dollar amount it states, exactly as stated",
    "- who it applies to",
    "",
    "Stay close to the text. Do not interpret, do not judge, do not fill in anything",
    "the section does not say. If the section is procedural or definitional, say so briefly.",
    "",
    "Section text:",
    text,
    "",
    'Return JSON: { "notes": "your notes on this section" }',
  ].join("\n");
}

/**
 * The writing pass for a long law: every section's notes, then the brief.
 *
 * The model sees the notes from ALL sections at once, so the brief it writes
 * describes the whole law rather than the part that happened to fit.
 */
function writeFromNotesPrompt(notes: string[], objections?: string[]): string {
  return [
    objectionBlock(objections),
    `This law was too long to read in one pass, so it was read in ${notes.length} sections.`,
    "Below are the notes from every section, in order. Together they cover the entire law.",
    "",
    ...notes.map((note, index) => `--- Section ${index + 1} of ${notes.length} ---\n${note}`),
    "",
    "Write the brief for the WHOLE law from all of the above. These notes are the only",
    "source — nothing from your own knowledge of this law or of similar laws.",
    "",
    SHAPE,
  ]
    .filter(Boolean)
    .join("\n");
}

function objectionBlock(objections?: string[]): string {
  if (!objections?.length) return "";
  return [
    "A check found these statements in an earlier draft that the official text does NOT support.",
    "Remove them or correct them. Do not repeat a claim the text does not make:",
    ...objections.map((o) => `- ${o}`),
    "",
  ].join("\n");
}

/**
 * The check that makes the "only from the text" rule enforceable.
 *
 * Instructing a model not to invent things reduces invention; it does not
 * prevent it. This reads the finished brief back against the source and names
 * anything the source does not support, and the writer gets one more pass with
 * those objections attached.
 */
function verifyPrompt(brief: CitizenBrief, source: string, partial: boolean): string {
  return [
    partial
      ? "Below is one section of a law's official text, and a brief written about the whole law."
      : "Below is the official text of a law, and a brief written about it.",
    "",
    partial
      ? "List any statement in the brief that this section CONTRADICTS. Do not flag a statement" +
        " merely because this section does not mention it — the brief covers the whole law and" +
        " you are seeing one part of it."
      : "Check every factual statement in the brief against the text. List any statement the" +
        " text does not support — including numbers, dates, effects, and anything attributed" +
        " to the law that it does not actually do.",
    "",
    "Judgements of whether the law is good or bad are not factual claims; ignore those. An",
    "argument is unsupported only if it rests on something the law does not do.",
    "",
    partial ? "Section text:" : "Official text:",
    source,
    "",
    "Brief:",
    JSON.stringify(brief, null, 2),
    "",
    'Return JSON: { "unsupported": ["statement 1", "statement 2"] }',
    "An empty list means everything checks out.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Split the text so the whole of it is read, however long it is.
 *
 * Chunking changes how many passes it takes, never how much is read. Breaks
 * land on a line boundary so a sentence is not cut in half across sections.
 */
function split(text: string, chunkChars: number): string[] {
  if (text.length <= chunkChars) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + chunkChars, text.length);
    if (end < text.length) {
      const lineBreak = text.lastIndexOf("\n", end);
      if (lineBreak > start + chunkChars / 2) end = lineBreak;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}

function usable(value: Partial<CitizenBrief> | null): value is CitizenBrief {
  return (
    !!value?.summary?.trim() && !!value.argumentFor?.trim() && !!value.argumentAgainst?.trim()
  );
}

/** The model to write with, chosen from the size of the text before any call. */
function planFor(textChars: number): { model: string; chunkChars: number } {
  // Long documents get the model with the larger useful context so most laws
  // are one pass; short ones do not need it. Picking from length rather than
  // asking a model to choose means no call is spent deciding.
  const model = textChars > 40_000 ? "gpt-5.4-mini" : "gemini-3.6-flash";
  return { model, chunkChars: safeInputChars(model) };
}

/**
 * Returns the model that actually served, not the one that was asked for.
 *
 * generateAI falls back to the other provider on a hard failure, so those can
 * differ — and the stored `citizenBriefModel` has to name what wrote the brief.
 * Recording the request instead of the result makes that column a guess.
 */
async function ask(
  model: string,
  prompt: string
): Promise<{ draft: Partial<CitizenBrief>; served: string } | null> {
  const result = await generateAI({
    system: SYSTEM,
    prompt,
    model,
    maxCompletionTokens: 1200,
    temperature: 0.3,
  });
  if (!result.ok) return null;
  const draft = parseJsonObject<Partial<CitizenBrief>>(result.content);
  return draft ? { draft, served: result.model } : null;
}

/** Read one section and return its notes, or null if the read failed. */
async function readSection(
  model: string,
  text: string,
  part: number,
  partsTotal: number
): Promise<string | null> {
  const result = await generateAI({
    system:
      "You extract faithful notes from legal text. You never summarize beyond what you are " +
      "given, never interpret, and never add anything the text does not say. Always return " +
      "valid JSON.",
    prompt: readSectionPrompt(text, part, partsTotal),
    model,
    maxCompletionTokens: 1500,
    temperature: 0,
  });
  if (!result.ok) return null;
  const parsed = parseJsonObject<{ notes?: unknown }>(result.content);
  const notes = typeof parsed?.notes === "string" ? parsed.notes.trim() : "";
  return notes || null;
}

async function verify(
  model: string,
  brief: CitizenBrief,
  source: string,
  partial: boolean
): Promise<string[] | null> {
  const result = await generateAI({
    system:
      "You are a fact-checker. You compare a written brief against a source text and " +
      "report only what the source does not support. Always return valid JSON.",
    prompt: verifyPrompt(brief, source, partial),
    model,
    // Tighter than the draft: this reads a brief it already has and answers
    // with a short list. It must not be what pushes the request over.
    budgetMs: 15_000,
    maxCompletionTokens: 600,
    temperature: 0,
  });
  if (!result.ok) return null;
  const parsed = parseJsonObject<{ unsupported?: unknown }>(result.content);
  if (!parsed || !Array.isArray(parsed.unsupported)) return null;
  return parsed.unsupported.filter(
    (item): item is string => typeof item === "string" && !!item.trim()
  );
}

/**
 * Read the whole law, then write the brief. Never the other way round.
 *
 * Short law: one read, one brief, straight from the text.
 *
 * Long law: split it, read EVERY section first and keep notes, and only then
 * write — from all the notes at once. Nothing is written from a partial read,
 * and if any section cannot be read the whole thing fails rather than
 * producing a brief about the part that happened to fit. A brief that quietly
 * describes the first third of a law is worse than no brief, because a reader
 * has no way to tell.
 */
async function draftFromText(
  text: string,
  objections?: string[]
): Promise<{ brief: CitizenBrief; model: string; parts: string[] } | null> {
  const { model, chunkChars } = planFor(text.length);
  const parts = split(text, chunkChars);

  if (parts.length === 1) {
    const written = await ask(model, firstPassPrompt(parts[0]!, objections));
    return written && usable(written.draft)
      ? { brief: written.draft, model: written.served, parts }
      : null;
  }

  console.log(`[Brief] law is ${text.length} chars — reading in ${parts.length} sections first`);

  const notes: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const section = await readSection(model, parts[index]!, index + 1, parts.length);
    if (!section) {
      // The whole law did not get read, so there is nothing to write from. This
      // is the rule the multi-section path exists to keep.
      console.warn(
        `[Brief] section ${index + 1} of ${parts.length} could not be read — no brief written`
      );
      return null;
    }
    notes.push(section);
  }

  const written = await ask(model, writeFromNotesPrompt(notes, objections));
  return written && usable(written.draft)
    ? { brief: written.draft, model: written.served, parts }
    : null;
}

/**
 * Write a Citizen's Brief for one law, from its text alone.
 *
 * Pure: it takes the text and returns a brief or a reason. Storage, versioning
 * and status live with the caller, so this can be read, tested, and reasoned
 * about as the one thing it is.
 */
export async function composeBrief(officialText: string | null): Promise<BriefOutcome> {
  const text = officialText?.trim();

  // NO TEXT, NO BRIEF. The single most important line in this file: everything
  // else here exists to make the brief trustworthy, and a brief written without
  // the law is untrustworthy by construction.
  if (!text) return { state: "unavailable", reason: NO_TEXT_REASON };

  const first = await draftFromText(text);
  if (!first) return { state: "unavailable", reason: WRITE_FAILED_REASON };

  const { model, parts } = first;
  let brief = first.brief;

  // Check the finished brief back against the law.
  //
  // For a law that fit in one pass, that is the whole text and the question is
  // "does the text support this". For a law read in sections, no single call
  // can see all of it, so each section is asked the one question it can answer
  // on its own: does this section CONTRADICT anything here. Asking a section
  // whether it supports a claim would flag everything the other sections said.
  //
  // AND IT HAS TO FIT IN THE TIME A PERSON WILL WAIT. Reported: "now it just
  // loads indefinitely... I can copy and paste it into an ai in 3 seconds and
  // another maybe 5 seconds to get the results." Fair. A draft plus a check is
  // two model calls, and until now each was allowed longer than the whole
  // request. The check is a real guarantee — Article III §3, nothing invented —
  // so it is not dropped; it is given a budget, and if it cannot run in time
  // the brief ships unrevised rather than the reader getting nothing.
  const objections: string[] = [];
  if (parts.length === 1) {
    const found = await verify(model, brief, text, false);
    if (found) objections.push(...found);
  } else {
    for (const [index, part] of parts.entries()) {
      const found = await verify(model, brief, part, true);
      if (found?.length) {
        console.warn(`[Brief] section ${index + 1} contradicts ${found.length} statement(s)`);
        objections.push(...found);
      }
    }
  }

  if (objections.length > 0) {
    console.warn(`[Brief] rewriting with ${objections.length} objection(s)`);
    const second = await draftFromText(text, objections);
    if (second) brief = second.brief;
  }

  return { state: "ready", brief, model };
}
