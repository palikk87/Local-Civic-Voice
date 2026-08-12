/**
 * Congress roster — every sitting Senator and Representative.
 *
 * Serves the Congress section of the Government screen on BOTH faucets
 * (mobile `(tabs)/government.tsx` and web `pages/Government.tsx`).
 * Data comes from services/congress-members.ts (live Congress.gov, cached 24h).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getMemberById, getMembers } from "../services/congress-members";
import type { Member } from "../types";

const representativesRouter = new Hono();

const listQuerySchema = z.object({
  search: z.string().optional(),
  chamber: z.enum(["house", "senate", "all"]).optional().default("all"),
  party: z.enum(["R", "D", "I", "all"]).optional().default("all"),
  state: z.string().optional(),
  /** Only members currently holding a leadership post. */
  leadership: z.enum(["true", "false"]).optional(),
});

function matchesSearch(rep: Member, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (
    rep.name.toLowerCase().includes(q) ||
    rep.state.toLowerCase() === q ||
    rep.stateName.toLowerCase().includes(q) ||
    (rep.leadershipRole?.toLowerCase().includes(q) ?? false)
  );
}

/**
 * GET /api/representatives?search=&chamber=&party=&state=&leadership=
 */
representativesRouter.get("/", zValidator("query", listQuerySchema), async (c) => {
  const { search, chamber, party, state, leadership } = c.req.valid("query");
  const roster = await getMembers();

  let results = roster.members;

  if (chamber !== "all") results = results.filter((rep) => rep.chamber === chamber);
  if (party !== "all") results = results.filter((rep) => rep.party === party);
  if (state) {
    const s = state.trim().toLowerCase();
    results = results.filter(
      (rep) => rep.state.toLowerCase() === s || rep.stateName.toLowerCase() === s
    );
  }
  if (leadership === "true") results = results.filter((rep) => rep.leadershipRole !== null);
  if (search && search.trim()) results = results.filter((rep) => matchesSearch(rep, search));

  return c.json({
    data: {
      representatives: results,
      counts: {
        house: roster.members.filter((rep) => rep.chamber === "house").length,
        senate: roster.members.filter((rep) => rep.chamber === "senate").length,
        total: roster.members.length,
      },
      congress: roster.congress,
      source: roster.source,
      lastUpdated: new Date(roster.fetchedAt).toISOString(),
    },
  });
});

/**
 * GET /api/representatives/:id — bioguide ID
 */
representativesRouter.get("/:id", async (c) => {
  const representative = await getMemberById(c.req.param("id"));

  if (!representative) {
    return c.json({ error: { message: "Representative not found", code: "NOT_FOUND" } }, 404);
  }

  return c.json({ data: { representative } });
});

export { representativesRouter };
