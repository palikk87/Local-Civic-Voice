// Delegates directory — EARNED eligibility only. The list comes from
// GET /api/delegations/delegates, which the backend computes from real,
// routine activity (account age, votes, posts, recent activity). Delegating
// and revoking go through /api/delegations, and delegated votes are counted
// into every reference tally server-side. Mobile twin: mobile/src/app/delegates.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, Users, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "@/hooks/use-debounce";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { api } from "@/lib/api";

interface DelegateListing {
  id: string;
  name: string;
  username: string;
  image: string | null;
  bio: string | null;
  delegatorCount: number;
  totalVotes: number;
  totalPosts: number;
  followerCount: number;
  topCategories: string[];
  memberSince: string;
}

interface DelegatesResponse {
  delegates: DelegateListing[];
  requirements: {
    MIN_ACCOUNT_AGE_DAYS: number;
    MIN_VOTES: number;
    MIN_POSTS: number;
    ACTIVE_WITHIN_DAYS: number;
  };
}

interface MyDelegation {
  id: string;
  toUser: { id: string; name: string; username: string | null; image: string | null };
  category: string | null;
  isActive: boolean;
}

interface EligibilityRequirement {
  key: string;
  label: string;
  required: number;
  current: number;
  met: boolean;
}

function avatarOf(d: { id: string; image: string | null }): string {
  return d.image ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${d.id}`;
}

function DelegateCard({
  delegate,
  myDelegation,
  onDelegate,
  onRevoke,
  busy,
}: {
  delegate: DelegateListing;
  myDelegation: MyDelegation | undefined;
  onDelegate: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex items-start gap-4">
        <Link to={`/user/${delegate.id}`}>
          <img
            src={avatarOf(delegate)}
            alt={delegate.name}
            className="h-14 w-14 rounded-full object-cover"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link to={`/user/${delegate.id}`} className="font-semibold text-foreground hover:underline">
              {delegate.name}
            </Link>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <ShieldCheck className="h-3 w-3" />
              Earned
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">@{delegate.username}</p>
          {delegate.bio ? (
            <p className="mt-2 line-clamp-2 text-sm text-foreground/80">{delegate.bio}</p>
          ) : null}

          {delegate.topCategories.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1">
              {delegate.topCategories.map((cat) => (
                <Badge key={cat} variant="secondary" className="text-xs capitalize">
                  {cat.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-3 gap-4 text-xs">
            <div>
              <p className="font-semibold text-foreground">{delegate.delegatorCount}</p>
              <p className="text-muted-foreground">Delegators</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">{delegate.totalVotes}</p>
              <p className="text-muted-foreground">Votes cast</p>
            </div>
            <div>
              <p className="font-semibold text-foreground">{delegate.followerCount}</p>
              <p className="text-muted-foreground">Followers</p>
            </div>
          </div>
        </div>
      </div>

      {myDelegation ? (
        <Button className="mt-4 w-full" variant="secondary" disabled={busy} onClick={onRevoke}>
          Delegating — tap to revoke
        </Button>
      ) : (
        <Button className="mt-4 w-full" variant="outline" disabled={busy} onClick={onDelegate}>
          Delegate to {delegate.name.split(" ")[0]}
        </Button>
      )}
    </div>
  );
}

export default function Delegates() {
  const [search, setSearch] = useState<string>("");
  const debouncedSearch = useDebounce(search, 300);
  const { isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["delegates-directory"],
    queryFn: () => api.get<DelegatesResponse>("/api/delegations/delegates"),
  });

  const { data: mine } = useQuery({
    queryKey: ["my-delegations"],
    queryFn: () => api.get<{ delegations: MyDelegation[] }>("/api/delegations/me"),
    enabled: isAuthenticated,
  });

  const { data: eligibility } = useQuery({
    queryKey: ["my-delegate-eligibility"],
    queryFn: () =>
      api.get<{ eligible: boolean; requirements: EligibilityRequirement[] }>(
        "/api/delegations/eligibility",
      ),
    enabled: isAuthenticated,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-delegations"] });
    queryClient.invalidateQueries({ queryKey: ["delegates-directory"] });
  };

  const delegateMutation = useMutation({
    mutationFn: (toUserId: string) =>
      api.post<{ delegation: MyDelegation }>("/api/delegations", { toUserId }),
    onSuccess: () => {
      toast.success("Delegation created", {
        description: "Their votes now carry your voice — revoke anytime.",
      });
      invalidate();
    },
    onError: (e: Error) => toast.error("Couldn't delegate", { description: e.message }),
  });

  const revokeMutation = useMutation({
    mutationFn: (delegationId: string) =>
      api.delete<{ success: boolean }>(`/api/delegations/${delegationId}`),
    onSuccess: () => {
      toast.success("Delegation revoked");
      invalidate();
    },
    onError: (e: Error) => toast.error("Couldn't revoke", { description: e.message }),
  });

  const requirements = data?.requirements;
  const query = debouncedSearch.trim().toLowerCase();
  const delegates = (data?.delegates ?? []).filter(
    (d) =>
      !query ||
      d.name.toLowerCase().includes(query) ||
      d.username.toLowerCase().includes(query) ||
      d.topCategories.some((c) => c.toLowerCase().includes(query)),
  );
  const myDelegationsByUser = new Map(
    (mine?.delegations ?? []).filter((d) => d.isActive).map((d) => [d.toUser.id, d]),
  );

  return (
    <AppShell>
      <div className="space-y-5">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <Users className="h-6 w-6 text-accent" />
            Delegates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hand your voting voice to someone you trust. Eligibility is earned through
            routine participation — never granted.
          </p>
        </div>

        {/* Your own eligibility progress */}
        {isAuthenticated && eligibility ? (
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-foreground">
                {eligibility.eligible
                  ? "You are an eligible delegate — others can delegate to you"
                  : "Your progress toward delegate eligibility"}
              </p>
              {eligibility.eligible ? (
                <Badge className="gap-1 bg-emerald-600 text-white">
                  <ShieldCheck className="h-3 w-3" />
                  Eligible
                </Badge>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {eligibility.requirements.map((req) => (
                <div key={req.key} className="flex items-center text-sm">
                  {req.met ? (
                    <CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <XCircle className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className={req.met ? "text-foreground/80" : "text-muted-foreground"}>
                    {req.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search delegates by name or expertise…"
            className="h-12 rounded-2xl pl-9"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-3 rounded-xl border border-border bg-card p-6">
                  <Skeleton className="h-14 w-14 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ))}
            </>
          ) : delegates.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-border py-16 text-center">
              <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-display text-lg text-foreground">
                No one has earned delegate eligibility yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Delegates must be routinely active citizens
                {requirements
                  ? ` — an account at least ${requirements.MIN_ACCOUNT_AGE_DAYS} days old, ${requirements.MIN_VOTES}+ votes, ${requirements.MIN_POSTS}+ posts, and activity within the last ${requirements.ACTIVE_WITHIN_DAYS} days`
                  : ""}
                . Keep participating and you could be the first.
              </p>
            </div>
          ) : (
            delegates.map((delegate) => (
              <DelegateCard
                key={delegate.id}
                delegate={delegate}
                myDelegation={myDelegationsByUser.get(delegate.id)}
                busy={delegateMutation.isPending || revokeMutation.isPending}
                onDelegate={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to delegate your vote.");
                    return;
                  }
                  delegateMutation.mutate(delegate.id);
                }}
                onRevoke={() => {
                  const d = myDelegationsByUser.get(delegate.id);
                  if (d) revokeMutation.mutate(d.id);
                }}
              />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
