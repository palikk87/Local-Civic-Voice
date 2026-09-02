import { existsSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

import { BIOGUIDE_ID, memberPortrait } from "../services/member-portraits";

/**
 * THE PORTRAIT OF A PRESIDENT, A JUSTICE OR A MEMBER OF CONGRESS, FROM HERE.
 *
 * Every president and every justice since 1789 is a closed, small set, so their
 * portraits were downloaded once and kept beside data/portraits.ts. This hands
 * them out. Nothing here reaches the network, nothing here touches the database,
 * and no request from a reader can be turned into one.
 *
 * MEMBERS OF CONGRESS ARE COLLECTED, NOT SHIPPED. Congress turns over, so
 * theirs are not a closed set that can be committed beside the code. The first
 * request for a member's face fetches it, checks the bytes really are an image,
 * and keeps it; every request after that is served from what we hold. See
 * services/member-portraits.ts for why the official source alone was not enough.
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
 */
const FILE_NAME = /^(Q\d+)\.jpg$/;

portraitsRouter.get("/:file", async (c) => {
  const file = c.req.param("file");

  /*
   * A MEMBER OF CONGRESS, BY BIOGUIDE ID.
   *
   * Same shape of address as a president's, so every caller — the record page,
   * the share card, the delegates screen — asks one place for a face and gets
   * one answer. The id pattern is the whole of the input validation: anything
   * that is not a letter and six digits never reaches a fetch or a query.
   */
  const member = /^([A-Z]\d{6})\.jpg$/.exec(file)?.[1];
  if (member && BIOGUIDE_ID.test(member)) {
    const portrait = await memberPortrait(member);
    if (!portrait) return c.json({ error: "Not found" }, 404);
    return new Response(portrait.image, {
      headers: {
        "Content-Type": portrait.contentType,
        // A member's official portrait does not change often, and when it does
        // a day-old copy is not a problem worth a cache miss on every card.
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const match = FILE_NAME.exec(file);
  if (!match) return c.json({ error: "Not found" }, 404);

  const path = join(PORTRAIT_DIR, `${match[1]}.jpg`);
  if (!existsSync(path)) return c.json({ error: "Not found" }, 404);

  // A portrait of a president who left office in 1837 is not going to change.
  // The id in the name is the person, so a hit is permanent by construction.
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
