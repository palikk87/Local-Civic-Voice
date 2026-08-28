/**
 * ASKED ONCE, AT THE MOMENT IT MATTERS.
 *
 * WHAT WAS WRONG. Voting publicly under your own name was the default, the
 * only switch for it lived in Settings, and nothing anywhere near the vote
 * button mentioned it. So somebody who never opened Settings had been putting
 * their name on public positions about immigration, healthcare and guns
 * without ever being told that is what they were doing.
 *
 * That is the gap a bug report walked into: "does it violate the anonymity
 * guaranteed by the constitution". The answer is no — the platform keeps the
 * promise it makes — but a promise nobody is shown is not much of an offer.
 *
 * WHY THE QUESTION LIVES HERE and not on eleven buttons. Every vote in this app
 * goes through castReferenceVote: the feed, the timeline, Discover, the library,
 * a detail page, a shared post. Putting a checkbox on each of those is how the
 * twelfth one gets missed — the exact bug that had just been fixed for author
 * links. One gate, in the pipeline, covers every surface that exists and every
 * surface anybody adds later.
 *
 * HOW IT WORKS. `chooseBeforeVoting()` resolves immediately once the account
 * has answered. Until then it raises the question and waits: the dialog, which
 * is mounted once, hears it, asks, saves the answer as the standing preference,
 * and resolves. The vote then proceeds exactly as it always did — the server
 * reads the standing preference and applies it, so nothing has to be threaded
 * through the eleven call sites.
 *
 * If they close the dialog without answering, the vote does not happen. That is
 * deliberate: the alternative is casting a public vote on behalf of somebody
 * who has just been asked and did not say yes.
 *
 * Phone twin: apps/mobile/src/lib/vote-anonymity.ts.
 */
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";

export interface VotePreferences {
  voteAnonymously: boolean;
  voteAnonymityChosen: boolean;
}

/** Thrown when somebody dismisses the question instead of answering it. */
export class AnonymityNotChosen extends Error {
  constructor() {
    super("The voter closed the anonymity question without answering it.");
    this.name = "AnonymityNotChosen";
  }
}

type Ask = (resolve: (named: boolean) => void, dismiss: () => void) => void;

let ask: Ask | null = null;

/**
 * The dialog registers itself here. One listener, because there is one dialog;
 * a second would mean two questions on screen at once.
 */
export function listenForTheQuestion(handler: Ask): () => void {
  ask = handler;
  return () => {
    if (ask === handler) ask = null;
  };
}

/**
 * What the account has settled on, or null when we cannot tell.
 *
 * Signed-out readers get null and are never asked — they cannot vote, and the
 * sign-in prompt is the thing standing in front of them.
 */
export async function votePreferences(): Promise<VotePreferences | null> {
  try {
    const answer = await queryClient.fetchQuery({
      queryKey: ["notification-preferences"],
      queryFn: () => api.get<{ preferences: VotePreferences }>("/api/notifications/preferences"),
      staleTime: 30_000,
    });
    const preferences = answer?.preferences;
    if (typeof preferences?.voteAnonymityChosen !== "boolean") return null;
    return preferences;
  } catch {
    // A preference we cannot read is not a reason to block somebody's vote.
    // The server still applies whatever standing choice it holds.
    return null;
  }
}

/** Record the answer, so nobody is asked twice. */
export async function rememberTheAnswer(named: boolean): Promise<void> {
  await api.put("/api/notifications/preferences", {
    voteAnonymously: !named,
    voteAnonymityChosen: true,
  });
  queryClient.setQueryData(["notification-preferences"], {
    preferences: { voteAnonymously: !named, voteAnonymityChosen: true },
  });
  void queryClient.invalidateQueries({ queryKey: ["notification-preferences"] });
}

/**
 * Ask, once, before the first vote this account ever casts.
 *
 * Resolves when the question is settled — immediately for everybody who has
 * already answered it. Throws AnonymityNotChosen if they dismiss it.
 */
export async function chooseBeforeVoting(): Promise<void> {
  const preferences = await votePreferences();

  // Already answered, or we could not tell. Either way, do not interrupt.
  if (!preferences || preferences.voteAnonymityChosen) return;

  // Nothing is listening — no dialog mounted, or a surface that does not have
  // one. Letting the vote through is the right failure: the server applies the
  // standing preference, which is the same thing that happened before any of
  // this existed.
  if (!ask) return;

  const named = await new Promise<boolean>((resolve, reject) => {
    ask?.(resolve, () => reject(new AnonymityNotChosen()));
  });

  await rememberTheAnswer(named);
}
