/**
 * THE vote pipeline — the only place the app casts a vote.
 *
 * Every law on the platform is one central record (the master reference), and
 * every citizen gets exactly one vote per law, no matter which surface they
 * vote from: a timeline post, the home feed, discover, the library, or a
 * detail page. This module:
 *
 *   1. optimistically flips the local "my vote" mirror (voting-store) and the
 *      tallies on every timeline post carrying the law,
 *   2. records the vote on POST /api/government-references/:id/vote — the
 *      server owns the toggle (same vote twice = vote removed) and returns the
 *      authoritative weighted tally,
 *   3. reconciles both stores with the server's answer and invalidates every
 *      React Query cache that shows the law, so all surfaces refetch the same
 *      numbers,
 *   4. reverts everything if the server rejects the vote.
 *
 * Mobile twin: webapp/mobile/src/lib/reference-votes.ts
 */
import { api } from '@/lib/api';
import { queryClient } from '@/lib/query-client';
import { useTimelineStore } from './timeline-store';
import { useVotingStore } from './voting-store';

export type ReferencePosition = 'support' | 'oppose';

export interface ReferenceVoteResult {
  vote: { position: ReferencePosition } | null;
  votes: { support: number; oppose: number; total: number };
}

export const positionToYeaNay = (p: ReferencePosition): 'yea' | 'nay' =>
  p === 'support' ? 'yea' : 'nay';

export const yeaNayToPosition = (v: 'yea' | 'nay'): ReferencePosition =>
  v === 'yea' ? 'support' : 'oppose';

/**
 * Mirror a vote the server told us about (e.g. a detail page loading
 * reference.userVote) into the local store, so every other card for the same
 * law shows it immediately.
 */
export function syncServerVote(referenceId: string, position: ReferencePosition | null): void {
  const store = useVotingStore.getState();
  const current = store.userVotes[referenceId] ?? null;
  const next = position ? positionToYeaNay(position) : null;
  if (current !== next) {
    store.setLocalVote(referenceId, next);
  }
}

/** Refetch everything that displays this law's tally. */
function invalidateReferenceQueries(referenceId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['government-references'] });
  void queryClient.invalidateQueries({ queryKey: ['reference', referenceId] });
  void queryClient.invalidateQueries({ queryKey: ['references'] });
  void queryClient.invalidateQueries({ queryKey: ['trending'] });
  void queryClient.invalidateQueries({ queryKey: ['algorithmic-feed'] });
  void queryClient.invalidateQueries({ queryKey: ['posts'] });
}

/**
 * Cast (or toggle off) my vote on a law's central record.
 *
 * Resolves with the server's authoritative result. Returns null without
 * throwing when the id isn't a real reference (mock/demo cards) — those keep
 * the optimistic local vote so demo content still responds, but nothing is
 * invented against the real tally.
 */
export async function castReferenceVote(
  referenceId: string,
  position: ReferencePosition
): Promise<ReferenceVoteResult | null> {
  const votingStore = useVotingStore.getState();
  const timelineStore = useTimelineStore.getState();

  const previousVote = votingStore.userVotes[referenceId] ?? null;
  const asYeaNay = positionToYeaNay(position);
  // Same vote again = toggle off, matching the server's semantics.
  const optimisticVote = previousVote === asYeaNay ? null : asYeaNay;

  const tallySnapshot = timelineStore.snapshotReferenceTally(referenceId);

  votingStore.setLocalVote(referenceId, optimisticVote);
  timelineStore.applyOptimisticReferenceVote(referenceId, position);

  try {
    const result = await api.post<ReferenceVoteResult>(
      `/api/government-references/${referenceId}/vote`,
      { position }
    );

    // Reconcile with the authoritative answer.
    votingStore.setLocalVote(
      referenceId,
      result.vote ? positionToYeaNay(result.vote.position) : null
    );
    useTimelineStore
      .getState()
      .applyReferenceTally(referenceId, result.votes, result.vote?.position ?? null);
    invalidateReferenceQueries(referenceId);
    return result;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 404) {
      // Not a central law record (mock/demo card). Keep the optimistic local
      // vote so the demo card responds, but there is no real tally to touch.
      return null;
    }
    // Real failure: put everything back the way it was.
    votingStore.setLocalVote(referenceId, previousVote);
    if (tallySnapshot) {
      useTimelineStore.getState().restoreReferenceTally(referenceId, tallySnapshot);
    }
    throw error;
  }
}
