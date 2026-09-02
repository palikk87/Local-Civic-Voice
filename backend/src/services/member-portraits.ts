/**
 * A MEMBER OF CONGRESS'S FACE, COLLECTED AS WE MEET THEM AND KEPT.
 *
 * WHY THIS EXISTS. Every card and every record page built the portrait URL
 * itself and pointed it straight at congress.gov. Measured across the live set,
 * that source is not dependable enough to be the only one: it has no photograph
 * at all for several sitting members, and for at least one it answers with
 * 65,536 bytes of something beginning "\x00nod", labelled image/jpeg, every
 * time it is asked. A rasteriser handed that dies, and the card died with it.
 *
 * Presidents and justices never had this problem because their portraits are
 * ours — downloaded once, kept beside the code, served from our own domain.
 * Congress is not a closed set and it turns over, so instead of a bulk
 * download this collects a member the first time anything asks for their face
 * and never asks a second time.
 *
 * THE ORDER OF SOURCES IS THE POINT. congress.gov first because it is the
 * official one; the unitedstates.io mirror second because it is a curated copy
 * of exactly this set and it is reliable; Wikipedia last because it is the one
 * that throttles. Whichever answers with real image bytes wins, and which one
 * it was is recorded — so a source that starts lying can be found rather than
 * guessed at.
 */
import { prisma } from "../prisma";

/** A miss is worth re-checking eventually; somebody may have uploaded one. */
const RETRY_A_MISS_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Nothing smaller is a photograph of a person. */
const TOO_SMALL_TO_BE_A_FACE = 1000;

export const PORTRAIT_SOURCES: Array<(bioguideId: string) => string> = [
  (id) => `https://bioguide.congress.gov/photo/${id}.jpg`,
  (id) => `https://unitedstates.github.io/images/congress/450x550/${id}.jpg`,
  (id) => `https://theunitedstates.io/images/congress/450x550/${id}.jpg`,
];

/**
 * WHAT THESE BYTES ACTUALLY ARE, by their own signature.
 *
 * The Content-Type header is not evidence — the corrupt answer described above
 * arrives labelled image/jpeg. A JPEG starts FF D8 FF and a PNG starts with its
 * eight-byte signature; anything else is not a photograph whatever it claims.
 */
export function imageKind(bytes: Uint8Array | Buffer): string | null {
  if (bytes.length < TOO_SMALL_TO_BE_A_FACE) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => bytes[index] === byte)) return "image/png";
  return null;
}

/** The Bioguide id shape, and the whole of the input validation here. */
export const BIOGUIDE_ID = /^[A-Z]\d{6}$/;

async function download(
  url: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    // Uint8Array rather than Buffer: it is what Prisma's Bytes column takes.
    const bytes = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>;
    const contentType = imageKind(bytes);
    return contentType ? { bytes, contentType } : null;
  } catch {
    return null;
  }
}

export interface StoredPortrait {
  /**
   * Typed against ArrayBuffer rather than the wider ArrayBufferLike because
   * that is what Prisma's Bytes column accepts — the wider type admits a
   * SharedArrayBuffer, which a column cannot take.
   */
  image: Uint8Array<ArrayBuffer>;
  contentType: string;
}

/**
 * The member's face: from what we hold, or fetched now and held from here.
 *
 * Returns null when nobody has one. That is a real answer — four sitting
 * members have no photograph at any source — and the card and the page both
 * render the name without it rather than a placeholder standing in for a
 * person.
 */
export async function memberPortrait(bioguideId: string): Promise<StoredPortrait | null> {
  if (!BIOGUIDE_ID.test(bioguideId)) return null;

  const held = await prisma.memberPortrait.findUnique({ where: { bioguideId } });
  if (held?.image) {
    return {
      image: new Uint8Array(held.image) as Uint8Array<ArrayBuffer>,
      contentType: held.contentType ?? "image/jpeg",
    };
  }
  // A miss we recorded recently is an answer, not a reason to ask again.
  if (held && Date.now() - held.checkedAt.getTime() < RETRY_A_MISS_AFTER_MS) return null;

  for (const build of PORTRAIT_SOURCES) {
    const source = build(bioguideId);
    const got = await download(source);
    if (!got) continue;

    await prisma.memberPortrait.upsert({
      where: { bioguideId },
      create: { bioguideId, image: got.bytes, contentType: got.contentType, source, attempts: 1 },
      update: {
        image: got.bytes,
        contentType: got.contentType,
        source,
        checkedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    return { image: got.bytes, contentType: got.contentType };
  }

  // Every source refused. Remember that, so the next hundred cards do not ask.
  await prisma.memberPortrait.upsert({
    where: { bioguideId },
    create: { bioguideId, attempts: 1 },
    update: { checkedAt: new Date(), attempts: { increment: 1 } },
  });
  return null;
}
