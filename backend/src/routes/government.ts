import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchCongressBills } from "../services/congress-search";
import { searchExecutiveDocuments } from "../services/executive-search";
import { searchJudicialOpinions } from "../services/judicial-search";
import type { CongressSearchResponse, Member, Official } from "../types";

const governmentRouter = new Hono();

// Query validation schema
const searchQuerySchema = z.object({
  q: z.string().min(1, "Search query is required"),
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 20),
  offset: z.string().optional().transform((val) => val ? parseInt(val, 10) : 0),
});

interface FederalRegisterResult {
  results: Array<{
    title: string;
    type: string;
    /** "Executive Order", "Proclamation", "Memorandum", … */
    subtype: string;
    abstract: string;
    publication_date: string;
    /** Date the President signed it — preferred over publication_date for display. */
    signing_date: string;
    /** Bare EO number ("14385") for real executive orders, else "". */
    executive_order_number: string;
    president: string;
    agencies: Array<{ name: string }>;
    html_url: string;
    document_number: string;
  }>;
  count: number;
}

interface CourtListenerResult {
  results: Array<{
    id: number;
    case_name: string;
    court: string;
    date_filed: string;
    docket_number: string;
    absolute_url: string;
  }>;
  count: number;
  next?: string;
}

/**
 * GET /api/government/congress/search
 * Multi-source relevance search for Congress bills. Merges GovInfo full-text
 * search, web-search-grounded AI interpretation, explicit bill references, the
 * recently-updated pool, and the app's own GovernmentReference table — see
 * services/congress-search.ts.
 */
governmentRouter.get(
  "/congress/search",
  zValidator("query", searchQuerySchema),
  async (c) => {
    const { q, limit, offset } = c.req.valid("query");
    const apiKey = process.env.CONGRESS_API_KEY;

    if (!apiKey) {
      return c.json(
        { error: "Congress API key not configured" },
        { status: 500 }
      );
    }

    try {
      const output = await searchCongressBills(apiKey, q, limit, offset);
      console.log(
        `[congress-search] "${q}" -> ${output.totalMatched} matched`,
        `[grounding: ${output.interpretation.groundedSnippets} snippet(s)]`,
        output.interpretation.expandedTerms.length > 0
          ? `(expanded: ${output.interpretation.expandedTerms.join(", ")})`
          : "",
      );

      const result: CongressSearchResponse = {
        results: output.results.map((bill) => ({
          congress: bill.congress,
          number: bill.number,
          title: bill.title,
          type: bill.type,
          originChamber: bill.originChamber,
          latestAction: bill.latestAction,
          url: bill.url,
          masterReferenceId: bill.masterReferenceId,
          reference: bill.reference,
          // WHY THIS RESULT IS HERE. Both were computed and then thrown away,
          // which is why "these look like preloaded results rather than my
          // search" took an investigation instead of a glance. `relevance` is
          // the part of the score earned by matching the query — it is always
          // above zero for a returned result — and `matchedVia` names the
          // sources that found it (govinfo-title, db-reference, recent, ...).
          relevance: bill.relevance,
          matchedVia: bill.matchedVia,
        })),
        pagination: {
          count: output.totalMatched,
        },
      };

      return c.json(result);
    } catch (error) {
      console.error("Congress search error:", error);
      return c.json(
        { error: "Internal server error while fetching Congress data" },
        { status: 500 }
      );
    }
  }
);

/**
 * GET /api/government/executive/search
 *
 * Proxy to the Federal Register API for executive orders, proclamations and
 * presidential memoranda. Filtered to PRESDOCU (presidential documents) — both
 * faucets label this search "Search executive orders...", so regulatory notices
 * from agencies are noise here.
 *
 * Fields are requested explicitly because the defaults omit the ones the
 * clients need: executive_order_number (so a result can be resolved to the real
 * EO), signing_date (shown instead of publication date) and subtype (drives the
 * category chip).
 */
governmentRouter.get(
  "/executive/search",
  zValidator("query", searchQuerySchema),
  async (c) => {
    const { q, limit } = c.req.valid("query");

    try {
      const output = await searchExecutiveDocuments(q, limit);

      console.log(
        `[executive-search] "${q}" -> ${output.results.length} shown` +
          (output.intent.interpreted
            ? ` | understood as "${output.intent.topic}"` +
              (output.intent.phrases.length > 0
                ? ` [${output.intent.phrases.map((p) => `"${p}"`).join(", ")}]`
                : " [no phrase]")
            : " | NOT interpreted — searched the words as typed") +
          ` | ${output.attempted.join("; ")}`,
      );

      const result: FederalRegisterResult = {
        results: output.results.map((doc) => ({
          title: doc.title,
          type: doc.type,
          subtype: doc.subtype,
          abstract: doc.abstract,
          publication_date: doc.publication_date,
          signing_date: doc.signing_date,
          executive_order_number: doc.executive_order_number,
          president: doc.president,
          agencies: doc.agencies,
          html_url: doc.html_url,
          document_number: doc.document_number,
        })),
        count: output.count,
      };

      return c.json(result);
    } catch (error) {
      console.error("Federal Register search error:", error);
      return c.json(
        { error: "Internal server error while fetching Federal Register data" },
        { status: 500 }
      );
    }
  }
);

/**
 * GET /api/government/judicial/search
 *
 * Proxy to the CourtListener API for court opinions and cases.
 *
 * Uses v4. v3 is closed to new API keys ("As a new user, you don't have
 * permission to access V3 of the API"), which silently broke judicial search on
 * both faucets. The rest of the backend already speaks v4 — see
 * services/reference-content.ts, which fetches opinion text by the same
 * opinions[].id this route returns.
 *
 * v4 paginates by opaque cursor rather than page number, so `offset` cannot be
 * translated into a request param; the upstream `next` URL is passed through for
 * callers that need the following page.
 */
governmentRouter.get(
  "/judicial/search",
  zValidator("query", searchQuerySchema),
  async (c) => {
    const { q, limit } = c.req.valid("query");

    if (!process.env.COURTLISTENER_API_KEY) {
      return c.json({ error: "CourtListener API key not configured" }, { status: 500 });
    }

    try {
      const output = await searchJudicialOpinions(q, limit);

      console.log(
        `[judicial-search] "${q}" -> ${output.results.length} shown` +
          (output.intent.interpreted
            ? ` | understood as "${output.intent.topic}"` +
              (output.intent.phrases.length > 0
                ? ` [${output.intent.phrases.map((p) => `"${p}"`).join(", ")}]`
                : " [no phrase]")
            : " | NOT interpreted — searched the words as typed") +
          ` | ${output.attempted.join("; ")}`,
      );

      const result: CourtListenerResult = {
        results: output.results.map((item) => ({
          id: item.id,
          case_name: item.case_name,
          court: item.court,
          date_filed: item.date_filed,
          docket_number: item.docket_number,
          absolute_url: item.absolute_url,
        })),
        count: output.count,
        next: output.next,
      };

      return c.json(result);
    } catch (error) {
      console.error("CourtListener search error:", error);
      return c.json(
        { error: "Internal server error while fetching CourtListener data" },
        { status: 500 }
      );
    }
  }
);

governmentRouter.get("/officials", async (c) => {
  const { EXECUTIVE, JUDICIAL, DEPARTMENTS, GOVERNMENT_DATA_META } = await import(
    "../data/federal-government"
  );
  const { getLeadership } = await import("../services/congress-members");

  // Positions 2 and 3 in the line of succession are held by Congress, so they have to
  // be stitched in from the live roster rather than hardcoded.
  const leaders = await getLeadership();

  /** Present a member of Congress in the same shape as an executive/judicial official. */
  const asOfficial = (member: Member): Official => ({
    id: member.id,
    name: member.name,
    title: member.leadershipRole ?? member.title,
    shortTitle: member.leadershipRole ?? member.title,
    branch: "legislative",
    group: "congressional-leadership",
    acting: false,
    party: member.party,
    department: member.chamber === "senate" ? "body-senate" : "body-house",
    since: member.servingSince ? String(member.servingSince) : null,
    appointedBy: null,
    photoUrl: member.photoUrl,
    website: member.website,
    phone: member.phone,
    bio: `${member.title}. ${member.partyName}.`,
    successionOrder: null,
  });

  const congressionalLeadership = leaders.map(asOfficial);

  const findLeader = (match: RegExp): Official | undefined =>
    congressionalLeadership.find((o) => match.test(o.title));

  const speaker = findLeader(/^Speaker of the House/i);
  const presidentProTempore = findLeader(/President Pro Tempore/i);

  const succession: Official[] = [
    ...EXECUTIVE.filter((o) => o.successionOrder === 1),
    ...(speaker ? [{ ...speaker, successionOrder: 2 }] : []),
    ...(presidentProTempore ? [{ ...presidentProTempore, successionOrder: 3 }] : []),
    ...EXECUTIVE.filter((o) => o.successionOrder !== null && o.successionOrder > 3),
  ].sort((a, b) => (a.successionOrder ?? 99) - (b.successionOrder ?? 99));

  return c.json({
    data: {
      executive: EXECUTIVE,
      judicial: JUDICIAL,
      departments: DEPARTMENTS,
      succession,
      congressionalLeadership,
      lastUpdated: GOVERNMENT_DATA_META.lastUpdated,
      sources: GOVERNMENT_DATA_META.sources,
    },
  });
});

export { governmentRouter };
