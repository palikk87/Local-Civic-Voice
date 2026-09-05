/**
 * Finding an order by what it is about, for the few days nobody else can.
 *
 * THE GAP THIS FILLS, precisely. Executive order search forwards the reader's
 * question to the Federal Register, whose full-text relevance is good and
 * covers every order it has published. It cannot cover an order it has not
 * published yet, and that is three to seven days from signing. During those
 * days the only copy in existence is ours.
 *
 * AND A TITLE IS NOT ENOUGH. The order that started this work is called
 * "Supporting America's Ranchers". Somebody who had seen the news went looking
 * for it under "Mexican wolves" — a phrase that appears seven times in the
 * order's body and not once in its name. Matching on the title would have
 * failed that reader exactly as the old search did.
 *
 * SO: THE SHELF ONLY, AND IT IS TINY. Measured across 593 days, the number of
 * orders signed but not yet published is a median of 2, a mean of 2.7, zero on
 * 183 of those days, and 40 at its worst — inauguration week, January 2025.
 * Embedding every order signed in the last nineteen months would cost about a
 * cent and a half. Cosine over 815 vectors was measured at 1.7ms, so there is
 * no index here and no extension: an array of floats and a loop is the right
 * size of solution for a median of two rows.
 *
 * Once the Register publishes an order this stops being written for it. The
 * Register's own search takes over, and it searches the body text — proved with
 * mid-document phrases that appear in no abstract.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { hashText } from "./reference-content";
import { NumberStatus } from "./executive-order-numbering";

/**
 * The model, in one place.
 *
 * text-embedding-3-small at $0.02 per million tokens. This is the cheap tier
 * already — an embedding model is a different and far smaller thing than the
 * chat models the rest of the platform uses, and there is nothing below it
 * worth dropping to. Swapping providers means changing this function and
 * nothing else.
 */
const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * How much of an order is embedded.
 *
 * An order runs 8,000 to 30,000 characters and the model takes 8,191 tokens,
 * roughly 32,000. Well inside it — but the opening of an order is boilerplate
 * ("By the authority vested in me as President by the Constitution and the laws
 * of the United States of America, it is hereby ordered"), identical across
 * every one of them, so a truncation that kept only the opening would make
 * every order look alike. This keeps enough that the subject matter dominates.
 */
const MAX_EMBED_CHARS = 24_000;

export function embeddingAvailable(): boolean {
  return !!env.OPENAI_API_KEY;
}

/**
 * Turn text into a vector. Null on any failure, including no key configured.
 *
 * Null is a real answer here and callers treat it as one: an order with no
 * vector is simply not in the semantic results, which is a smaller wrong than
 * a search that errors out or one that silently returns everything.
 */
export async function embed(text: string): Promise<number[] | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const input = text.slice(0, MAX_EMBED_CHARS).trim();
  if (!input) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.warn(`[Embeddings] ${EMBEDDING_MODEL} answered ${response.status}`);
      return null;
    }
    const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = body.data?.[0]?.embedding;
    return Array.isArray(vector) && vector.length > 0 ? vector : null;
  } catch {
    return null;
  }
}

/**
 * Cosine similarity, -1 to 1. Both vectors come from the same model, so they
 * are the same length; a mismatch means something is stored that should not be
 * and answering 0 is safer than answering with a truncated comparison.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

function parseVector(stored: string | null): number[] | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number") ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Give every order still waiting on a number a current vector.
 *
 * Skips a record whose stored vector was computed from the text it still holds.
 * The text can change under us — the White House re-publishes an order when the
 * signed PDF is attached — and a search against a vector of the old words is a
 * search against a document that no longer exists.
 */
export async function embedPendingOrders(): Promise<{ embedded: number; skipped: number; failed: number }> {
  const result = { embedded: 0, skipped: 0, failed: 0 };
  if (!embeddingAvailable()) return result;

  const waiting = await prisma.governmentReference.findMany({
    where: { numberStatus: NumberStatus.PENDING, mergedIntoId: null, fullText: { not: null } },
    select: { id: true, masterReferenceId: true, fullText: true, textEmbedding: true, textEmbeddingHash: true },
  });

  for (const record of waiting) {
    const currentHash = hashText(record.fullText!);
    if (record.textEmbedding && record.textEmbeddingHash === currentHash) {
      result.skipped++;
      continue;
    }

    const vector = await embed(`${record.masterReferenceId}\n${record.fullText}`);
    if (!vector) {
      result.failed++;
      continue;
    }

    await prisma.governmentReference.update({
      where: { id: record.id },
      data: { textEmbedding: JSON.stringify(vector), textEmbeddingHash: currentHash },
    });
    result.embedded++;
  }

  return result;
}

export interface ShelfHit {
  id: string;
  masterReferenceId: string;
  slug: string | null;
  title: string;
  signedDate: Date | null;
  similarity: number;
}

/**
 * How alike a question and an order must be to show the order.
 *
 * Cosine over this model runs high for any two pieces of English — unrelated
 * documents sit around 0.1 to 0.2 — so this is not "half related". It is set to
 * let a real subject match through ("Mexican wolves" against an order that
 * discusses them at length) while keeping an unrelated question from dragging
 * in whatever happens to be on the shelf that week.
 */
export const SHELF_MATCH_FLOOR = 0.3;

/**
 * The pending orders that answer a reader's question.
 *
 * Returns nothing rather than failing when there is no key, no shelf, or the
 * question cannot be embedded. This runs alongside the Federal Register search,
 * and the Register's results are the ones a reader must get either way.
 */
export async function searchPendingOrders(query: string, limit = 5): Promise<ShelfHit[]> {
  const trimmed = query.trim();
  if (!trimmed || !embeddingAvailable()) return [];

  const shelf = await prisma.governmentReference.findMany({
    where: {
      numberStatus: NumberStatus.PENDING,
      mergedIntoId: null,
      textEmbedding: { not: null },
    },
    select: {
      id: true,
      masterReferenceId: true,
      slug: true,
      title: true,
      signedDate: true,
      textEmbedding: true,
    },
  });
  if (shelf.length === 0) return [];

  const asked = await embed(trimmed);
  if (!asked) return [];

  const scored: ShelfHit[] = [];
  for (const record of shelf) {
    const vector = parseVector(record.textEmbedding);
    if (!vector) continue;
    const similarity = cosine(asked, vector);
    if (similarity < SHELF_MATCH_FLOOR) continue;
    scored.push({
      id: record.id,
      masterReferenceId: record.masterReferenceId,
      slug: record.slug,
      title: record.title,
      signedDate: record.signedDate,
      similarity,
    });
  }

  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
