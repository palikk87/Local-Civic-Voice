import { existsSync } from "node:fs";
import { join } from "node:path";

import { Hono } from "hono";

/**
 * THE PORTRAIT OF A PRESIDENT OR A JUSTICE, SERVED FROM HERE.
 *
 * Every president and every justice since 1789 is a closed, small set, so their
 * portraits were downloaded once and kept beside data/portraits.ts. This hands
 * them out. Nothing here reaches the network, nothing here touches the database,
 * and no request from a reader can be turned into one.
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
  const match = FILE_NAME.exec(c.req.param("file"));
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
