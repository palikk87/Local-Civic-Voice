/**
 * THIS PLATFORM CARRIES THE SUPREME COURT. NOTHING ELSE WEARS ITS NAME.
 *
 * WHAT WENT WRONG. The Library's judicial search asked CourtListener across the
 * whole federal judiciary — its own comment said so: "Every federal court is
 * still reachable, the Supreme Court is simply asked first." Four of its six
 * queries carried no court filter, two labelled "(all courts)". One recorded
 * response, kept as a test fixture, is five results and not one of them is the
 * Supreme Court: the D.C. Circuit, two Texas Courts of Appeals, the Court of
 * Federal Claims, the Tennessee Supreme Court.
 *
 * Opening any of those files it as a scotus_case, because that is what the
 * judicial branch maps to. So a Maryland magistrate judge's order — "In re the
 * United States for an Order Authorizing Disclosure of Location Information",
 * docket case-no-10-2188-skg — was published here as a ruling of the Supreme
 * Court of the United States, with Aye and Nay buttons under it. That is a
 * false record, and no ranking or labelling makes it less false.
 *
 * The search is scoped now and the ingest refuses another court. This is the
 * third part: what was stored before either of those existed.
 *
 * WHAT GOES, AND WHY IT GOES WHOLE. Khalid, overriding the rule that a record
 * somebody has voted on is never deleted:
 *
 *   "I don't care if anyone has posted any posts or votes on it. this was a
 *    failure on our part so allowing those to continue even if anyone has done
 *    anything on any of them that are not supreme court is unacceptable. I am
 *    overriding all rules we've set on this matter in order to correct course."
 *
 * That is the right call and the reasoning is his: a vote on a record that
 * should never have been published is a vote on something this platform
 * invented. Keeping the record to preserve the vote preserves the false claim.
 * So the ruling goes, and with it every post about it, every vote on it, every
 * name it answered to, and every position it put on somebody's ledger.
 *
 * THE ONE RULE THAT REMAINS, because it protects against a different failure:
 * NOTHING GOES ON SUSPICION. A record is removed only when CourtListener
 * POSITIVELY names a court that is not the Supreme Court. A request that fails,
 * times out, or answers with nothing leaves the record alone — a network
 * problem must never be able to empty this table.
 */
import { prisma } from "../prisma";
import { env } from "../env";
import { SUPREME_COURT } from "./judicial-search";

/** The opinion id inside a CourtListener URL: /opinion/6461471/case-name/ */
export function opinionIdFromUrl(sourceUrl: string | null | undefined): number | null {
  const match = /courtlistener\.com\/opinion\/(\d+)/.exec(sourceUrl ?? "");
  const id = match ? Number(match[1]) : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * The court id out of a cluster, however that answer is shaped.
 *
 * CourtListener gives `court_id` on some responses and `court` as a resource
 * URL — ".../api/rest/v4/courts/scotus/" — on others. Both are read rather than
 * picking one, because getting this wrong in the safe direction means deleting
 * a real Supreme Court ruling.
 */
export function courtIdOf(cluster: { court_id?: unknown; court?: unknown } | null): string | null {
  if (!cluster) return null;
  if (typeof cluster.court_id === "string" && cluster.court_id.trim()) {
    return cluster.court_id.trim().toLowerCase();
  }
  if (typeof cluster.court === "string") {
    const segment = cluster.court.replace(/\/+$/, "").split("/").pop();
    if (segment && segment.trim()) return segment.trim().toLowerCase();
  }
  return null;
}

interface ClusterPage {
  results?: Array<{ court_id?: string; court?: string }>;
}

/** Which court issued this opinion, or null when we could not find out. */
async function courtFor(opinionId: number): Promise<string | null> {
  const apiKey = env.COURTLISTENER_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch(
      `https://www.courtlistener.com/api/rest/v4/clusters/?sub_opinions=${opinionId}`,
      {
        headers: { Authorization: `Token ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) return null;
    const page = (await response.json()) as ClusterPage;
    return courtIdOf(page.results?.[0] ?? null);
  } catch {
    return null;
  }
}

export interface PurgeResult {
  checked: number;
  /** Confirmed to be the Supreme Court, or the source would not say. */
  kept: number;
  /** Removed, with everything attached to them. */
  purged: string[];
  /** What went with them, so the log says the true size of the correction. */
  removed: { posts: number; votes: number; names: number; positions: number };
}

/**
 * ONE RULING AND EVERY TRACE OF IT.
 *
 * Most of what hangs off a reference cascades: its votes, the names it has
 * answered to, the positions it put on people's ledgers, its merge candidates.
 * Two things do not, and both would be left behind by a plain delete:
 *
 *   POSTS. The relation is optional with no delete rule, so Prisma's default
 *   sets the column to null — the post survives, detached, still on somebody's
 *   My Voice, still saying they shared a Supreme Court ruling. Deleted here,
 *   which takes their comments, likes, saves and shares with them.
 *
 *   MERGED-IN RECORDS. Another reference may point at this one as the survivor
 *   of a merge. Its pointer is cleared rather than followed, so it stands on
 *   its own and this same pass judges it on its own court.
 */
async function removeRulingWholly(id: string): Promise<PurgeResult["removed"]> {
  return prisma.$transaction(async (tx) => {
    const posts = await tx.post.deleteMany({ where: { governmentReferenceId: id } });
    const votes = await tx.governmentReferenceVote.count({ where: { governmentReferenceId: id } });
    const names = await tx.referenceName.count({ where: { referenceId: id } });
    const positions = await tx.positionEvent.count({ where: { governmentReferenceId: id } });

    // A roll call is congressional and a ruling has none, but the relation is
    // SetNull rather than a cascade, so an unexpected one would be left behind.
    await tx.rollCall.deleteMany({ where: { governmentReferenceId: id } });
    await tx.governmentReference.updateMany({
      where: { mergedIntoId: id },
      data: { mergedIntoId: null },
    });

    // The rest cascades from here.
    await tx.governmentReference.delete({ where: { id } });

    return { posts: posts.count, votes, names, positions };
  });
}

/**
 * Every stored ruling, checked against the court that issued it.
 *
 * Merged records are checked too. A ruling that was folded into another is
 * still a stored record with a page, and if it is not the Supreme Court's it
 * does not belong here either.
 *
 * Idempotent and cheap once clean: one request per stored ruling, and there are
 * seventeen. Safe to run at boot — on a settled table it confirms and changes
 * nothing.
 */
export async function purgeNonScotusRulings(): Promise<PurgeResult> {
  const rulings = await prisma.governmentReference.findMany({
    where: { referenceType: "scotus_case" },
    select: { id: true, masterReferenceId: true, title: true, sourceUrl: true },
  });

  const result: PurgeResult = {
    checked: 0,
    kept: 0,
    purged: [],
    removed: { posts: 0, votes: 0, names: 0, positions: 0 },
  };

  for (const ruling of rulings) {
    const opinionId = opinionIdFromUrl(ruling.sourceUrl);
    if (!opinionId) {
      // No CourtListener opinion to ask about. Not evidence of anything.
      result.kept += 1;
      continue;
    }

    result.checked += 1;
    const court = await courtFor(opinionId);
    if (court === null || court === SUPREME_COURT) {
      result.kept += 1;
      continue;
    }

    const label = `${ruling.masterReferenceId} "${ruling.title.slice(0, 70)}" (${court})`;
    const removed = await removeRulingWholly(ruling.id);
    result.purged.push(label);
    result.removed.posts += removed.posts;
    result.removed.votes += removed.votes;
    result.removed.names += removed.names;
    result.removed.positions += removed.positions;

    console.warn(
      `[ScotusOnly] removed ${label} — not a ruling of the Supreme Court. ` +
        `With it: ${removed.posts} post(s), ${removed.votes} vote(s), ` +
        `${removed.names} name(s), ${removed.positions} position(s).`,
    );
  }

  if (result.purged.length > 0) {
    console.warn(
      `[ScotusOnly] ${result.checked} ruling(s) checked, ${result.purged.length} removed, ` +
        `${result.kept} kept`,
    );
  }
  return result;
}
