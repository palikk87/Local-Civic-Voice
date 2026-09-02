import { existsSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

import { OFFICIAL_PORTRAIT_SOURCES } from "../data/federal-government";
import { memberPhotoSource } from "../services/congress-members";
import { BIOGUIDE_ID, PORTRAIT_KEY, memberPortrait } from "../services/member-portraits";

/**
 * EVERY FACE ON THIS PLATFORM, SERVED FROM HERE.
 *
 * Presidents and justices were downloaded once and kept beside data/portraits,
 * because that set is closed and small — 45 and 115 since 1789, and no more
 * arriving this week. Members of Congress and the thirty-six executive and
 * judicial posts are not a closed set, so they are not a folder: they are
 * COLLECTED AS WE MEET THEM. The first request for a person fetches their
 * photograph once and keeps it; everybody after is served from what we hold.
 *
 * WHY IT WORKS THIS WAY AT ALL. Until now every card and every Government
 * screen handed the reader's browser a congress.gov or Wikimedia address and
 * hoped. Measured across the 244 people who have sponsored something here, that
 * hope failed for five of them — four with no photograph at that host, and one
 * answered with 65,536 bytes that are not an image. Now nothing on a page names
 * an outside host, and a source that fails is a source we try after, not a
 * missing face.
 *
 * FOLDER FIRST, ALWAYS. A file on disk is one read, no network, no database,
 * and it cannot fail halfway. A miss falls through to
 * services/member-portraits.ts, which fetches once, checks the bytes really are
 * a picture, and keeps it — so a member sworn in tomorrow closes their own gap
 * the first time anybody looks at them.
 *
 * PUBLIC ON PURPOSE. These are official portraits of public officials attached
 * to public law. There is nothing to authenticate and nobody to identify.
 */
export const portraitsRouter = new Hono();

const PORTRAIT_DIR = join(import.meta.dir, "..", "data", "portraits");

/**
 * The file name is an entity id and nothing else.
 *
 * This is the whole of the path safety here: the parameter never reaches the
 * filesystem unless it matches, so "..", a slash, an absolute path and a URL
 * escape are all simply not names — they are refused before any join happens.
 * `Q<n>` is a president or a justice, keyed to the person rather than to a name;
 * everything else PORTRAIT_KEY allows is a member of Congress or a public post.
 */
const FILE_NAME = /^(Q\d+|[A-Z]\d{6}|official-[a-z0-9-]{2,40})\.(?:jpg|png)$/;

const TYPE_BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", png: "image/png" };

/** The file we hold for this person, whichever of the two formats it is in. */
function heldFile(key: string): { path: string; contentType: string } | null {
  for (const [extension, contentType] of Object.entries(TYPE_BY_EXTENSION)) {
    const path = join(PORTRAIT_DIR, `${key}.${extension}`);
    if (existsSync(path)) return { path, contentType };
  }
  return null;
}

portraitsRouter.get("/:file", async (c) => {
  const key = FILE_NAME.exec(c.req.param("file"))?.[1];
  if (!key) return c.json({ error: "Not found" }, 404);

  const held = heldFile(key);
  if (held) {
    // The id in the name is the person, so a hit is permanent by construction:
    // the portrait of a president who left office in 1837 is not going to change.
    return new Response(Bun.file(held.path), {
      headers: {
        "Content-Type": held.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  /*
   * SOMEBODY WE HAVE NOT MET YET. A member of Congress, or a post in the
   * executive or judicial branch. Fetched once, checked, and kept — so this
   * costs the first reader a moment and costs everybody after them nothing.
   *
   * A president or a justice never gets here — their set is closed and already
   * complete, so a Q id the folder does not have is not a person, it is a typo.
   */
  if (!PORTRAIT_KEY.test(key)) return c.json({ error: "Not found" }, 404);

  /*
   * THE BEST URL ANYBODY HAS, HANDED TO THE FETCH BEFORE IT GUESSES.
   *
   * For a public post that is the address recorded in data/federal-government —
   * there is no directory of cabinet photographs to fall back on. For a member
   * of Congress it is whatever Congress.gov's own API named in the roster,
   * which is a content hash nothing can derive from a bioguide id, and which is
   * the only place one sitting member's photograph exists at all.
   *
   * Passed unevaluated for a member, because reading it can mean loading the
   * whole roster and a face we already hold must not pay for that.
   */
  const portrait = await memberPortrait(
    key,
    BIOGUIDE_ID.test(key)
      ? () => memberPhotoSource(key)
      : (OFFICIAL_PORTRAIT_SOURCES[key] ?? null),
  );
  if (!portrait) return c.json({ error: "Not found" }, 404);

  return new Response(portrait.image, {
    headers: {
      "Content-Type": portrait.contentType,
      // Shorter than the folder's, on purpose: this face arrived over the
      // network from a source that has been wrong before. A day is long enough
      // that no card pays for the fetch twice, and short enough that a better
      // photograph is not a year away.
      "Cache-Control": "public, max-age=86400",
    },
  });
});
