import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { safetyApi, type SafetyListEntry } from "@/lib/civic";

/**
 * Who you have blocked and muted, and how to undo it.
 *
 * A block you cannot see is a block you cannot lift. The endpoints have listed
 * both since they were written; there was nowhere to read them, so the only way
 * to unblock somebody was to open their profile — which a block makes
 * unreachable.
 */
function PeopleList({
  title,
  description,
  icon,
  entries,
  isLoading,
  emptyText,
  actionLabel,
  onUndo,
  pending,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  entries: SafetyListEntry[];
  isLoading: boolean;
  emptyText: string;
  actionLabel: string;
  onUndo: (userId: string) => void;
  pending: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-semibold text-foreground">{title}</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <Separator className="my-4" />

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{entry.user.name}</p>
                {entry.user.username ? (
                  <p className="truncate text-xs text-muted-foreground">@{entry.user.username}</p>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => onUndo(entry.user.id)}
              >
                {actionLabel}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BlockedAndMuted() {
  const queryClient = useQueryClient();

  const blocks = useQuery({ queryKey: ["blocks"], queryFn: safetyApi.blocks });
  const mutes = useQuery({ queryKey: ["mutes"], queryFn: safetyApi.mutes });

  const unblock = useMutation({
    mutationFn: (userId: string) => safetyApi.unblock(userId),
    onSuccess: () => {
      toast.success("Unblocked", {
        // Said plainly, because people expect unblocking to restore what a
        // block took away, and it does not.
        description: "Following is not restored — that is a separate decision.",
      });
      void queryClient.invalidateQueries({ queryKey: ["blocks"] });
    },
    onError: () => toast.error("Couldn't unblock them"),
  });

  const unmute = useMutation({
    mutationFn: (userId: string) => safetyApi.unmute(userId),
    onSuccess: () => {
      toast.success("Unmuted");
      void queryClient.invalidateQueries({ queryKey: ["mutes"] });
    },
    onError: () => toast.error("Couldn't unmute them"),
  });

  return (
    <>
      <PeopleList
        title="Blocked"
        description="You do not see each other, and they cannot reach you. They are never told."
        icon={<Ban className="h-4 w-4 text-oppose" aria-hidden="true" />}
        entries={blocks.data?.results ?? []}
        isLoading={blocks.isLoading}
        emptyText="You have not blocked anyone."
        actionLabel="Unblock"
        onUndo={(id) => unblock.mutate(id)}
        pending={unblock.isPending}
      />

      <PeopleList
        title="Muted"
        description="Their posts stay out of your feed. They can still reach you, and they are never told."
        icon={<VolumeX className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
        entries={mutes.data?.results ?? []}
        isLoading={mutes.isLoading}
        emptyText="You have not muted anyone."
        actionLabel="Unmute"
        onUndo={(id) => unmute.mutate(id)}
        pending={unmute.isPending}
      />
    </>
  );
}
