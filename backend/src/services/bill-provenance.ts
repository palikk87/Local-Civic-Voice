/**
 * WHEN A BILL HAPPENED, AND WHO PUT IT FORWARD.
 *
 * WHAT THIS REPLACES. Neither fact was stored, so the client mapper filled the
 * gap twice over:
 *
 *   introducedDate and lastActionDate were both set to `ref.createdAt` — the
 *   moment OUR row was written. A statute from 2007 therefore displayed as
 *   introduced today, and every record on the platform appeared to date from
 *   whenever we happened to sync it. A date is a fact about the legislation,
 *   not about our database.
 *
 *   The sponsor was a chamber: "U.S. House of Representatives", party
 *   "Independent", state "US", with a blank avatar. Bills are sponsored by a
 *   member. congress.gov names them, with a bioguide id that joins the same
 *   roster the Delegates screen already renders.
 *
 * WHY A SEPARATE PASS. The bill LIST endpoint carries latestAction but neither
 * the introduced date nor the sponsor; those need one detail call per bill. So
 * the sync writes what the list gives it immediately, and this fills the rest
 * afterwards, for records that are still missing it. Nothing here blocks a
 * sync, and a failure leaves the columns null — which reads as "we do not know
 * yet" and renders as nothing, rather than as a guess.
 */

import { prisma } from "../prisma";
import { congressGovKey, env } from "./../env";

interface BillDetail {
  bill?: {
    introducedDate?: string;
    latestAction?: { actionDate?: string; text?: string };
    sponsors?: Array<{
      bioguideId?: string;
      fullName?: string;
      firstName?: string;
      lastName?: string;
      party?: string;
      state?: string;
    }>;
  };
}

/** "hr-3194-119" -> the three parts congress.gov wants. Null when it is not a bill id. */
export function parseBillId(
  masterReferenceId: string,
): { type: string; number: string; congress: string } | null {
  // hr-3194-119, s-1779-119, hjres-12-119, s-res-829-119 ...
  const match = /^([a-z]+(?:-[a-z]+)?)-(\d+)-(\d+)$/.exec(masterReferenceId);
  if (!match) return null;
  const [, rawType, number, congress] = match;
  // congress.gov spells them without the hyphen: s-res -> sres.
  return { type: rawType!.replace(/-/g, ""), number: number!, congress: congress! };
}

/** A date congress.gov gives as "2025-04-08", or null when it gives nothing usable. */
function toDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Party as a single letter, matching the roster.
 *
 * congress.gov returns "R", "D", "I" here but "Republican" elsewhere, so both
 * are accepted and anything else is dropped rather than guessed at — a wrong
 * party letter beside a real member's name is worse than no letter.
 */
function partyLetter(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.trim().charAt(0).toUpperCase();
  return first === "D" || first === "R" || first === "I" ? first : null;
}

async function fetchDetail(masterReferenceId: string): Promise<BillDetail["bill"] | null> {
  const apiKey = congressGovKey();
  if (!apiKey) return null;

  const parsed = parseBillId(masterReferenceId);
  if (!parsed) return null;

  try {
    const response = await fetch(
      `https://api.congress.gov/v3/bill/${parsed.congress}/${parsed.type}/${parsed.number}` +
        `?format=json&api_key=${apiKey}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return null;
    return ((await response.json()) as BillDetail).bill ?? null;
  } catch {
    // Left null on purpose. See the header: not knowing renders as nothing.
    return null;
  }
}

export interface ProvenanceResult {
  considered: number;
  filled: number;
  skipped: number;
}

/**
 * Fill dates and sponsor for stored bills that are still missing them.
 *
 * `limit` is small by default and this runs on the sync's schedule rather than
 * per request: it is one congress.gov call per bill, and the point is to
 * converge over days without ever being on a reader's critical path.
 */
export async function fillBillProvenance(limit = 25): Promise<ProvenanceResult> {
  const pending = await prisma.governmentReference.findMany({
    where: {
      referenceType: "bill",
      mergedIntoId: null,
      // Either fact missing is reason enough to ask; one call returns both.
      OR: [{ introducedDate: null }, { sponsorBioguideId: null }],
    },
    select: { id: true, masterReferenceId: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  let filled = 0;
  let skipped = 0;

  for (const ref of pending) {
    const detail = await fetchDetail(ref.masterReferenceId);
    if (!detail) {
      skipped++;
      continue;
    }

    const sponsor = detail.sponsors?.[0];
    const introduced = toDate(detail.introducedDate);
    const lastAction = toDate(detail.latestAction?.actionDate);

    const data: Record<string, unknown> = {};
    if (introduced) data.introducedDate = introduced;
    if (lastAction) data.lastActionDate = lastAction;
    if (detail.latestAction?.text) data.lastActionText = detail.latestAction.text;
    if (sponsor?.bioguideId) data.sponsorBioguideId = sponsor.bioguideId;

    // fullName is "Rep. Smith, Adam [D-WA-9]" in some responses; first + last is
    // the clean form when both are present.
    const name =
      sponsor?.firstName && sponsor?.lastName
        ? `${sponsor.firstName} ${sponsor.lastName}`
        : sponsor?.fullName;
    if (name) data.sponsorName = name;

    const party = partyLetter(sponsor?.party);
    if (party) data.sponsorParty = party;
    if (sponsor?.state) data.sponsorState = sponsor.state.toUpperCase();

    // Nothing usable came back. Writing an empty update would only touch
    // updatedAt and make the record look freshly checked when it is not.
    if (Object.keys(data).length === 0) {
      skipped++;
      continue;
    }

    await prisma.governmentReference.update({ where: { id: ref.id }, data });
    filled++;
  }

  if (pending.length > 0) {
    console.log(
      `[Provenance] ${filled} filled, ${skipped} skipped, of ${pending.length} bills missing a date or sponsor`,
    );
  }

  return { considered: pending.length, filled, skipped };
}
