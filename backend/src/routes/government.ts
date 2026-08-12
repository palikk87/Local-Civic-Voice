import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { searchCongressBills } from "../services/congress-search";
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

interface FederalRegisterApiResponse {
  results?: Array<{
    title?: string;
    type?: string;
    subtype?: string;
    abstract?: string | null;
    publication_date?: string;
    signing_date?: string | null;
    executive_order_number?: string | number | null;
    president?: { name?: string } | null;
    agencies?: Array<{ name?: string }>;
    html_url?: string;
    document_number?: string;
  }>;
  count?: number;
}

/**
 * CourtListener v4 search response. A result is an opinion CLUSTER: the case
 * metadata sits at the top level and the individual opinions (whose ids address
 * the actual text via /api/rest/v4/opinions/:id/) are nested under `opinions`.
 */
interface CourtListenerApiResponse {
  results?: Array<{
    cluster_id?: number;
    opinions?: Array<{ id?: number }>;
    caseName?: string;
    court?: string;
    dateFiled?: string;
    docketNumber?: string;
    absolute_url?: string;
  }>;
  count?: number;
  next?: string | null;
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
const FEDERAL_REGISTER_FIELDS = [
  "title",
  "type",
  "subtype",
  "abstract",
  "publication_date",
  "signing_date",
  "executive_order_number",
  "president",
  "agencies",
  "html_url",
  "document_number",
];
governmentRouter.get(
  "/executive/search",
  zValidator("query", searchQuerySchema),
  async (c) => {
    const { q, limit, offset } = c.req.valid("query");

    try {
      // Federal Register API is public and doesn't require an API key
      const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
      url.searchParams.set("conditions[term]", q);
      url.searchParams.set("conditions[type][]", "PRESDOCU");
      url.searchParams.set("per_page", limit.toString());
      url.searchParams.set("page", Math.floor(offset / limit + 1).toString());
      url.searchParams.set("order", "relevance");
      for (const field of FEDERAL_REGISTER_FIELDS) {
        url.searchParams.append("fields[]", field);
      }

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Federal Register API error:", response.status, errorText);
        return c.json(
          { error: "Failed to fetch from Federal Register API", details: errorText },
          { status: response.status }
        );
      }

      const data = (await response.json()) as FederalRegisterApiResponse;

      // Transform the response to a consistent format
      const result: FederalRegisterResult = {
        results: (data.results || []).map((doc) => ({
          title: doc.title ?? "",
          type: doc.type ?? "",
          subtype: doc.subtype ?? "",
          // The API returns null for documents with no abstract.
          abstract: doc.abstract ?? "",
          publication_date: doc.publication_date ?? "",
          signing_date: doc.signing_date ?? "",
          executive_order_number:
            doc.executive_order_number != null ? String(doc.executive_order_number) : "",
          president: doc.president?.name ?? "",
          agencies: (doc.agencies ?? []).map((a) => ({ name: a.name ?? "" })),
          html_url: doc.html_url ?? "",
          document_number: doc.document_number ?? "",
        })),
        count: data.count || 0,
      };

      return c.json(result);
    } catch (error) {
      console.error("Federal Register API proxy error:", error);
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
    const { q, limit, offset } = c.req.valid("query");
    const apiKey = process.env.COURTLISTENER_API_KEY;

    if (!apiKey) {
      return c.json(
        { error: "CourtListener API key not configured" },
        { status: 500 }
      );
    }

    try {
      const url = new URL("https://www.courtlistener.com/api/rest/v4/search/");
      url.searchParams.set("q", q);
      url.searchParams.set("type", "o"); // opinions
      url.searchParams.set("page_size", limit.toString());

      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          Authorization: `Token ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("CourtListener API error:", response.status, errorText);
        return c.json(
          { error: "Failed to fetch from CourtListener API", details: errorText },
          { status: response.status }
        );
      }

      const data = (await response.json()) as CourtListenerApiResponse;

      // Transform the response to a consistent format
      const result: CourtListenerResult = {
        // v4 ignores page_size and always returns a full page of 20, so the
        // caller's limit is applied here instead.
        results: (data.results || []).slice(0, limit).map((cluster) => ({
          // The opinion id addresses the actual text; fall back to the cluster
          // id so a result is never left without an identifier.
          id: cluster.opinions?.find((o) => typeof o.id === "number")?.id ?? cluster.cluster_id ?? 0,
          case_name: cluster.caseName || "",
          court: cluster.court || "",
          date_filed: cluster.dateFiled || "",
          docket_number: cluster.docketNumber || "",
          absolute_url: cluster.absolute_url || "",
        })),
        count: data.count || 0,
        next: data.next ?? undefined,
      };

      return c.json(result);
    } catch (error) {
      console.error("CourtListener API proxy error:", error);
      return c.json(
        { error: "Internal server error while fetching CourtListener data" },
        { status: 500 }
      );
    }
  }
);

/**
 * GET /api/government/officials
 *
 * The executive and judicial branches: President, Vice President, the full Cabinet,
 * cabinet-rank officials, senior White House staff, and all nine Supreme Court
 * Justices — plus the departments they head and the presidential line of succession.
 *
 * Serves the Executive / Judicial / Leadership sections of the Government screen on
 * BOTH faucets. Congress comes from /api/representatives.
 */
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
