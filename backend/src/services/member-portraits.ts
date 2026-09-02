/**
 * A FACE IS COLLECTED THE FIRST TIME SOMEBODY ASKS FOR IT, AND KEPT.
 *
 * WHAT WAS WRONG. Every card and every Government screen was handed an address
 * on congress.gov or Wikimedia and left to fetch it itself, on every paint,
 * forever. Measured across all 244 people who have sponsored something on this
 * platform, bioguide.congress.gov — the only source both apps used — has no
 * photograph for four of them, and answers Ron Johnson (J000293) with 65,536
 * bytes beginning "\x00nod", labelled image/jpeg, every time it is asked. A
 * rasteriser handed that dies, and one share card died with it. Those five were
 * the gaps, and asking the same source again was never going to close them.
 *
 * WHAT HAPPENS NOW. Nothing on a page names an outside host. Every face is
 * asked of us, at /api/portraits/<id>.jpg. Presidents and justices are answered
 * from the files in data/portraits, downloaded long ago because that set is
 * closed and small. EVERYBODY ELSE IS COLLECTED AS WE MEET THEM: the first
 * request for a member of Congress or a public post fetches their photograph
 * once, checks the bytes really are a picture, and keeps it — so the second
 * reader, and every reader after, is served from here and nobody is asked twice.
 *
 * Congress turns over, so this is also the route for a member sworn in tomorrow
 * and for a sponsor who left before today. There is no list to keep up to date;
 * meeting somebody is what collects them.
 *
 * WHY THE BYTES ARE CHECKED. A Content-Type header is not evidence — the
 * corrupt answer above arrives labelled image/jpeg. A file signature is.
 *
 * THE ORDER OF SOURCES IS MEASURED, NOT ASSUMED. The caller's hint goes first
 * when there is one: for a member that is the photograph Congress.gov's own API
 * names in the roster, which is the only place one of those five faces exists,
 * and for a public post it is the URL recorded in data/federal-government. Then
 * the unitedstates.io mirror, a curated copy of exactly this set. Then
 * bioguide.congress.gov LAST, deliberately — it is the official one, and it is
 * also the only one measured returning rubbish.
 */
import { prisma } from "../prisma";
import { officialSourceHeaders } from "./official-source";

/** A miss is worth re-checking eventually; somebody may have uploaded one. */
const RETRY_A_MISS_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * WHICH SET OF SOURCES A MISS WAS RECORDED AGAINST.
 *
 * Remembering "nobody has one" is what stops four missing faces from becoming
 * thousands of requests. But it also means that ADDING A SOURCE FIXES NOBODY:
 * the people it would have helped are exactly the people already written off,
 * and they stay written off for a week.
 *
 * That is not hypothetical. Darline Graham (G000608) has no photograph at
 * bioguide.congress.gov and none at the unitedstates.io mirror; the roster's
 * own URL is the only place hers exists. The moment that source was added, the
 * remembered miss would have kept her faceless anyway.
 *
 * So a miss records the sources it was measured against. Change this string
 * whenever the source list changes — OR WHENEVER THE WAY THEY ARE ASKED
 * CHANGES, which is the same thing from a missing face's point of view. The
 * ";identified" on the end is when this began sending a User-Agent: Wikimedia
 * answers 403 without one, so every miss taken before that was a miss against
 * a question we were not really asking. Every miss recorded under an older
 * string is retried the next time anybody looks — once, and then remembered
 * again.
 */
const SOURCES_TRIED = "roster-hint,mirror,theunitedstates,bioguide;identified";

/** Nothing smaller is a photograph of a person. */
const TOO_SMALL_TO_BE_A_FACE = 1000;

/**
 * The sources that can be derived from a bioguide id alone, in the order they
 * are asked. A hint from the caller, when there is one, is asked before all of
 * these — see the note at the top for why bioguide.congress.gov is last.
 */
export const PORTRAIT_SOURCES: Array<(bioguideId: string) => string> = [
  (id) => `https://unitedstates.github.io/images/congress/450x550/${id}.jpg`,
  (id) => `https://theunitedstates.io/images/congress/450x550/${id}.jpg`,
  (id) => `https://bioguide.congress.gov/photo/${id}.jpg`,
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

/** The Bioguide id shape: a letter and six digits, and nothing else. */
export const BIOGUIDE_ID = /^[A-Z]\d{6}$/;

/**
 * EVERY NAME A PORTRAIT CAN BE ASKED FOR, and the whole of the input validation
 * on this path. A member of Congress by bioguide id, or a post in the executive
 * or judicial branch by the id data/federal-government already gives it. Nothing
 * else is a name: "..", a slash, an absolute path and a URL escape are all
 * refused here, before any filesystem join, fetch or query happens.
 */
export const PORTRAIT_KEY = /^(?:[A-Z]\d{6}|official-[a-z0-9-]{2,40})$/;

/**
 * SAY WHO IS ASKING. Wikimedia's policy requires it and it enforces it: the
 * same URL that answers 200 to curl answers 403 to a request with no
 * User-Agent. That is not theoretical — it is why Darline Graham's photograph,
 * which exists only on Wikimedia, was still missing after every other part of
 * this was working, and it would have taken all thirty-six cabinet and Supreme
 * Court portraits with it. The header this uses is the one the rest of the
 * platform already uses for official sources, built from BACKEND_URL so a
 * source that wants to complain can find us. See services/official-source.ts.
 */
async function download(
  url: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  try {
    const response = await fetch(url, {
      headers: officialSourceHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
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
 * Every place worth asking about this person's face, best first.
 *
 * The hint is whatever the caller already knows — the roster's own photograph
 * for a sitting member, the recorded URL for a cabinet post. A post has nothing
 * but its hint: there is no directory of cabinet photographs to guess at.
 */
export function portraitSourcesFor(key: string, hint?: string | null): string[] {
  const sources = hint?.trim() ? [hint.trim()] : [];
  if (BIOGUIDE_ID.test(key)) sources.push(...PORTRAIT_SOURCES.map((build) => build(key)));
  return sources;
}

/**
 * WHERE THE CALLER THINKS THIS FACE IS.
 *
 * A function rather than a string, when finding out costs something. The
 * roster's URL for a member is the best hint there is — for one sitting member
 * it is the only place a photograph exists — but reading it can mean loading
 * the whole roster, and a face we already hold must not pay for that. So the
 * hint is only asked for once we know we are about to go looking.
 */
export type PortraitHint = string | null | (() => Promise<string | null>);

/**
 * The face of somebody the folder does not have: from what we hold, or fetched
 * now and held from here.
 *
 * Returns null when nobody has one. That is a real answer — Everton Blair has
 * no photograph at any source we know of — and the card and the page both
 * render the name without it rather than a placeholder standing in for a person.
 */
export async function memberPortrait(
  key: string,
  hint?: PortraitHint,
): Promise<StoredPortrait | null> {
  if (!PORTRAIT_KEY.test(key)) return null;

  const held = await prisma.memberPortrait.findUnique({ where: { bioguideId: key } });
  if (held?.image) {
    return {
      image: new Uint8Array(held.image) as Uint8Array<ArrayBuffer>,
      contentType: held.contentType ?? "image/jpeg",
    };
  }
  // A miss we recorded recently is an answer, not a reason to ask again —
  // unless it was recorded before the sources changed, in which case it is an
  // answer to a question nobody is asking any more.
  const stale = held?.source !== SOURCES_TRIED;
  if (held && !stale && Date.now() - held.checkedAt.getTime() < RETRY_A_MISS_AFTER_MS) return null;

  const url = typeof hint === "function" ? await hint() : (hint ?? null);

  for (const source of portraitSourcesFor(key, url)) {
    const got = await download(source);
    if (!got) continue;

    await prisma.memberPortrait.upsert({
      where: { bioguideId: key },
      create: { bioguideId: key, image: got.bytes, contentType: got.contentType, source, attempts: 1 },
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

  // Every source refused. Remember that, so the next hundred cards do not ask —
  // and remember WHICH sources refused, so adding one un-remembers it.
  await prisma.memberPortrait.upsert({
    where: { bioguideId: key },
    create: { bioguideId: key, source: SOURCES_TRIED, attempts: 1 },
    update: { source: SOURCES_TRIED, checkedAt: new Date(), attempts: { increment: 1 } },
  });
  return null;
}
