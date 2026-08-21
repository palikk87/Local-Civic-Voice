import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface VoteDetails {
  support: { direct: number; delegated: number; total: number };
  oppose: { direct: number; delegated: number; total: number };
  total: number;
}

/**
 * A response is only usable if it actually carries the numbers.
 *
 * A backend that answers this route with something else — an error envelope, an
 * empty object, an older deploy that has no such route — must leave the panel
 * blank, not crash the page it sits on. Checking one field and then reading a
 * nested one is exactly how the Government page white-screened.
 */
function usable(data: unknown): data is VoteDetails {
  const d = data as VoteDetails | undefined;
  return (
    typeof d?.total === "number" &&
    typeof d?.support?.direct === "number" &&
    typeof d?.support?.delegated === "number" &&
    typeof d?.oppose?.direct === "number" &&
    typeof d?.oppose?.delegated === "number"
  );
}

/**
 * What the Pulse is made of.
 *
 * The Bill of Rights, Article III, gives every user the right "to know exactly
 * how many direct votes and delegated weights formed the Pulse". The platform
 * published a single merged number for both, which made that right unexercisable
 * — there was no screen, and no endpoint, that could answer the question.
 *
 * Counts only. Article IV promises anonymity, so this never says who.
 */
export function PulseBreakdown({
  referenceId,
  className,
}: {
  referenceId: string;
  className?: string;
}) {
  const { data } = useQuery({
    queryKey: ["vote-details", referenceId],
    queryFn: () => api.get<VoteDetails>(`/api/government-references/${referenceId}/vote-details`),
    enabled: Boolean(referenceId),
  });

  if (!usable(data) || data.total === 0) return null;

  const delegated = data.support.delegated + data.oppose.delegated;
  const direct = data.support.direct + data.oppose.direct;

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      <div className="flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        <span>
          <span className="font-mono font-semibold text-foreground">
            {direct.toLocaleString()}
          </span>{" "}
          voted directly
          {delegated > 0 ? (
            <>
              {" · "}
              <span className="font-mono font-semibold text-foreground">
                {delegated.toLocaleString()}
              </span>{" "}
              carried by delegation
            </>
          ) : null}
        </span>
      </div>

      {delegated > 0 ? (
        <p className="mt-1 leading-relaxed">
          Delegated voices belong to people who lent their vote and have not cast one here
          themselves. Any of them can take it back at any time, and the count changes at once.
        </p>
      ) : null}
    </div>
  );
}
