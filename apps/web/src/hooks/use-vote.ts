import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type GovReferenceDetail, type VotePosition } from "@/lib/civic";
import { castReferenceVote } from "@/lib/mobile/reference-votes";

/**
 * Vote mutation for a reference detail page.
 * Optimistically updates the cached detail (userVote toggle + counts) and
 * reconciles with the server response, which returns authoritative counts.
 */
export function useVote(id: string) {
  const queryClient = useQueryClient();
  const key = ["reference", id];

  return useMutation({
    mutationFn: async (position: VotePosition) => {
      // The ONE vote pipeline — updates the local vote mirror and timeline
      // tallies too, so every card for this law moves together.
      const result = await castReferenceVote(id, position);
      if (!result) throw new Error("This item is not connected to a real law record");
      return result;
    },
    onMutate: async (position) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ reference: GovReferenceDetail }>(key);

      if (previous) {
        const ref = previous.reference;
        const prevVote = ref.userVote;
        const votes = { ...ref.votes };
        let nextVote: VotePosition | null = position;

        // remove prior contribution
        if (prevVote === "support") votes.support = Math.max(0, votes.support - 1);
        if (prevVote === "oppose") votes.oppose = Math.max(0, votes.oppose - 1);

        if (prevVote === position) {
          // toggling off
          nextVote = null;
        } else {
          if (position === "support") votes.support += 1;
          else votes.oppose += 1;
        }
        votes.total = votes.support + votes.oppose;

        queryClient.setQueryData(key, {
          reference: { ...ref, userVote: nextVote, votes },
        });
      }

      return { previous };
    },
    onError: (_err, _position, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error("Could not record your vote. Please try again.");
    },
    onSuccess: (data) => {
      // reconcile authoritative counts from the server
      const current = queryClient.getQueryData<{ reference: GovReferenceDetail }>(key);
      if (current) {
        queryClient.setQueryData(key, {
          reference: { ...current.reference, votes: data.votes },
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ["references"] });
      queryClient.invalidateQueries({ queryKey: ["trending"] });
    },
  });
}
