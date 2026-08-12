/**
 * Web port of webapp/mobile/src/lib/api/references.ts (mapper half).
 *
 * Converts live GovernmentReference rows (the daily-synced store of bills,
 * executive orders, and SCOTUS cases) into the legacy Bill / ExecutiveOrder /
 * SupremeCourtCase shapes the existing Discover cards and detail pages render.
 */
import type { GovReference, GovReferenceDetail } from "@/lib/civic";
import type { Bill, ExecutiveOrder, SupremeCourtCase, BillCategory } from "@/lib/mobile/types";

const VALID_CATEGORIES: BillCategory[] = [
  "healthcare", "education", "environment", "economy", "civil_rights",
  "defense", "immigration", "technology", "housing", "infrastructure",
];

function toCategory(category: string | null | undefined): BillCategory {
  if (category && (VALID_CATEGORIES as string[]).includes(category)) {
    return category as BillCategory;
  }
  if (category === "justice") return "civil_rights";
  return "economy";
}

function toVoteTally(votes: GovReference["votes"]) {
  return { yea: votes.support, nay: votes.oppose, totalVoters: votes.total };
}

/** Who held the presidency on a given date — used when the source omits it. */
export function presidentAtDate(dateStr: string | null): string {
  const time = dateStr ? new Date(dateStr).getTime() : Date.now();
  if (time >= new Date("2025-01-20").getTime()) return "Donald Trump";
  if (time >= new Date("2021-01-20").getTime()) return "Joe Biden";
  if (time >= new Date("2017-01-20").getTime()) return "Donald Trump";
  if (time >= new Date("2009-01-20").getTime()) return "Barack Obama";
  return "the President";
}

export function referenceToBill(ref: GovReference | GovReferenceDetail): Bill {
  const chamber: "house" | "senate" = ref.chamber === "senate" ? "senate" : "house";
  const statusMap: Record<string, Bill["status"]> = {
    proposed: "introduced",
    introduced: "introduced",
    committee: "in_committee",
    passed: chamber === "senate" ? "passed_senate" : "passed_house",
    enacted: "enacted",
    signed: "signed_into_law",
    vetoed: "vetoed",
  };
  const summary =
    ref.citizenBrief ?? ref.description ?? ("fullText" in ref ? ref.fullText : null) ?? ref.title;
  const congressNumber = ref.masterReferenceId
    .replace(/-\d+$/, "")
    .replace(/^([a-z]+)-/, (_, p: string) => `${p.toUpperCase()}.`)
    .replace(/\.$/, ". ");

  return {
    id: ref.id,
    title: ref.title,
    shortTitle: ref.shortTitle ?? (ref.title.length > 60 ? `${ref.title.slice(0, 57)}...` : ref.title),
    status: statusMap[ref.status] ?? "introduced",
    chamber,
    sponsor: {
      id: "congress",
      name: chamber === "senate" ? "U.S. Senate" : "U.S. House of Representatives",
      party: "I",
      state: "US",
      chamber,
      imageUrl: "",
    },
    introducedDate: ref.createdAt,
    lastActionDate: ref.createdAt,
    category: toCategory(ref.category),
    congressNumber,
    congressUrl: ref.sourceUrl ?? undefined,
    fullText: ("fullText" in ref ? ref.fullText : null) ?? summary,
    simplifiedText: summary,
    realWorldImpact: ref.description ?? "",
    relatedLaws: [],
    communityVotes: toVoteTally(ref.votes),
    projectedOutcome: ref.votes.support > ref.votes.oppose ? "likely_pass" : "uncertain",
    branch: "legislative",
  };
}

export function referenceToExecutiveOrder(ref: GovReference | GovReferenceDetail): ExecutiveOrder {
  const statusMap: Record<string, ExecutiveOrder["status"]> = {
    active: "active",
    signed: "active",
    revoked: "revoked",
    superseded: "superseded",
    expired: "expired",
  };
  const summary =
    ref.citizenBrief ?? ref.description ?? `Executive order signed by President ${presidentAtDate(ref.signedDate)}.`;

  return {
    id: ref.id,
    eoNumber: `EO ${ref.masterReferenceId.replace(/^eo-/i, "").toUpperCase()}`,
    title: ref.title,
    shortTitle: ref.shortTitle ?? (ref.title.length > 60 ? `${ref.title.slice(0, 57)}...` : ref.title),
    president: presidentAtDate(ref.signedDate),
    signedDate: ref.signedDate ?? ref.createdAt,
    publishedDate: ref.signedDate ?? ref.createdAt,
    status: statusMap[ref.status] ?? "active",
    category: toCategory(ref.category),
    federalRegisterUrl: ref.sourceUrl ?? undefined,
    fullText: ("fullText" in ref ? ref.fullText : null) ?? summary,
    simplifiedText: summary,
    realWorldImpact: ref.description ?? "",
    communityVotes: toVoteTally(ref.votes),
    branch: "executive",
  };
}

export function referenceToScotusCase(ref: GovReference | GovReferenceDetail): SupremeCourtCase {
  const statusMap: Record<string, SupremeCourtCase["status"]> = {
    decided: "decided",
    argued: "argued",
    pending: "pending",
    dismissed: "dismissed",
    remanded: "remanded",
  };
  // SCOTUS terms start in October: a June 2026 decision belongs to the 2025 term.
  const decided = ref.decidedDate ? new Date(ref.decidedDate) : null;
  const term = decided
    ? String(decided.getMonth() + 1 >= 10 ? decided.getFullYear() : decided.getFullYear() - 1)
    : String(new Date(ref.createdAt).getFullYear());
  const [petitioner = "Petitioner", respondent = "Respondent"] = ref.title.split(/\s+v\.?\s+/i);
  const question = ref.citizenBrief ?? ref.description ?? ref.title;

  return {
    id: ref.id,
    docketNumber: ref.masterReferenceId.replace(/^scotus-/i, "").toUpperCase(),
    caseName: ref.title,
    shortName: ref.shortTitle ?? ref.title,
    term,
    decidedDate: ref.decidedDate ?? undefined,
    status: statusMap[ref.status] ?? (ref.decidedDate ? "decided" : "pending"),
    category: toCategory(ref.category),
    lowerCourt: "Federal courts",
    petitioner: petitioner.trim(),
    respondent: respondent.trim(),
    questionPresented: question,
    simplifiedQuestion: question,
    realWorldImpact: ref.description ?? "",
    communityVotes: toVoteTally(ref.votes),
    courtListenerUrl: ref.sourceUrl ?? undefined,
    branch: "judicial",
  };
}
