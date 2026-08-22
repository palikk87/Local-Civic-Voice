// Public profile — any user's profile and personal timeline (their own posts
// and shares), with follow and delegate actions. Mobile twin: mobile/src/app/user/[id].tsx
// Data: GET /api/users/:id, GET /api/posts?authorId=:id, POST /api/users/:id/follow,
// POST /api/delegations (server enforces earned delegate eligibility).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Loader2,
  MapPin,
  ShieldCheck,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { api } from "@/lib/api";
import { safetyApi } from "@/lib/civic";

interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  location: string;
  joinedDate: string;
  followers: number;
  following: number;
  votesCount: number;
  isFollowing: boolean;
  /** You follow each other. This platform has no friend request. */
  isFriend?: boolean;
}

interface UserPost {
  id: string;
  content: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceTitle: string | null;
  commentsCount: number;
  likesCount: number;
  createdAt: string;
}

interface MyDelegation {
  id: string;
  toUser: { id: string };
  isActive: boolean;
}

function referenceRoute(post: UserPost): string {
  const id = post.referenceId ?? "";
  switch (post.referenceType) {
    case "executive_order":
      return `/executive-order/${id}`;
    case "scotus_case":
      return `/scotus/${id}`;
    default:
      return `/bill/${id}`;
  }
}

export default function UserProfile() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: me, isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const isSelf = me?.id === id;

  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ["public-user", id],
    queryFn: () => api.get<PublicUser>(`/api/users/${id}`),
    enabled: !!id,
  });

  const { data: friendsData } = useQuery({
    queryKey: ["friends", id],
    queryFn: () =>
      api.get<{ pagination: { total: number } }>(`/api/users/${id}/friends?limit=1`),
    enabled: !!id,
  });
  const friendCount = friendsData?.pagination.total ?? 0;

  const { data: postsData, isLoading: postsLoading } = useQuery({
    queryKey: ["public-user-posts", id],
    queryFn: () =>
      api.get<{ posts: UserPost[] }>(`/api/posts?authorId=${encodeURIComponent(id)}&limit=30`),
    enabled: !!id,
  });

  const { data: mine } = useQuery({
    queryKey: ["my-delegations"],
    queryFn: () => api.get<{ delegations: MyDelegation[] }>("/api/delegations/me"),
    enabled: isAuthenticated && !isSelf,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["public-user", id] });
    queryClient.invalidateQueries({ queryKey: ["my-delegations"] });
  };

  const followMutation = useMutation({
    mutationFn: () => api.post<{ following: boolean }>(`/api/users/${id}/follow`),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error("Couldn't update follow", { description: e.message }),
  });

  const myDelegation = (mine?.delegations ?? []).find(
    (d) => d.isActive && d.toUser.id === id,
  );

  const delegateMutation = useMutation({
    mutationFn: () => api.post<{ delegation: MyDelegation }>("/api/delegations", { toUserId: id }),
    onSuccess: () => {
      toast.success("Delegation created", {
        description: "Their votes now carry your voice — revoke anytime.",
      });
      invalidate();
    },
    onError: (e: Error) =>
      toast.error("Not an eligible delegate", {
        description:
          "Delegates must be routinely active — enough votes, posts, and recent activity.",
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: () => api.delete<{ success: boolean }>(`/api/delegations/${myDelegation?.id}`),
    onSuccess: () => {
      toast.success("Delegation revoked");
      invalidate();
    },
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
        </div>
      </AppShell>
    );
  }

  // A DELETED ACCOUNT IS NOT A SLOW ONE.
  //
  // This used to fold "no profile" into the loading branch, so a link to an
  // account that no longer exists spun a loader forever. Nothing was coming.
  // Say so, and give them somewhere to go.
  if (isError || !profile) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-24 text-center">
          <h1 className="font-display text-xl font-semibold text-foreground">
            This account isn&apos;t here
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The profile may have been deleted, or the link may be wrong.
          </p>
          <Button className="mt-6" variant="outline" onClick={() => navigate("/")}>
            Back to the feed
          </Button>
        </div>
      </AppShell>
    );
  }

  const posts = postsData?.posts ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="-ml-2 my-3 text-muted-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>

        {/* Profile header */}
        <div className="flex flex-col items-center px-4 py-6">
          <img
            src={profile.avatar}
            alt={profile.displayName}
            className="h-24 w-24 rounded-full border-4 border-amber-500/30 object-cover"
          />
          <span className="mt-4 text-xl font-bold text-white">{profile.displayName}</span>
          <span className="text-slate-400">@{profile.username}</span>
          {profile.bio ? (
            <p className="mt-2 px-8 text-center text-slate-300">{profile.bio}</p>
          ) : null}
          <div className="mt-2 flex items-center text-sm text-slate-400">
            {profile.location ? (
              <>
                <MapPin size={14} />
                <span className="ml-1">{profile.location}</span>
                <span className="mx-2 text-slate-600">·</span>
              </>
            ) : null}
            <Calendar size={14} />
            <span className="ml-1">
              Joined{" "}
              {new Date(profile.joinedDate).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>

          <div className="mt-4 flex gap-8">
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold text-white">{friendCount}</span>
              {/* Friends here are the people who follow each other. There is no
                  friend request on this platform — see the friends route. */}
              <span className="text-sm text-slate-400">Friends</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold text-white">{profile.followers}</span>
              <span className="text-sm text-slate-400">Followers</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold text-white">{profile.following}</span>
              <span className="text-sm text-slate-400">Following</span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-lg font-bold text-white">{profile.votesCount}</span>
              <span className="text-sm text-slate-400">Votes</span>
            </div>
          </div>

          {/* Actions */}
          {!isSelf ? (
            <div className="mt-5 flex w-full max-w-sm gap-3">
              <Button
                className="flex-1"
                variant={profile.isFollowing ? "secondary" : "default"}
                disabled={followMutation.isPending}
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to follow people.");
                    return;
                  }
                  followMutation.mutate();
                }}
              >
                {profile.isFollowing ? (
                  <>
                    <UserMinus className="mr-1.5 h-4 w-4" />
                    {profile.isFriend ? "Friends" : "Unfollow"}
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-1.5 h-4 w-4" />
                    Follow
                  </>
                )}
              </Button>
              <Button
                className="flex-1"
                variant="outline"
                disabled={delegateMutation.isPending || revokeMutation.isPending}
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to delegate your vote.");
                    return;
                  }
                  if (myDelegation) {
                    revokeMutation.mutate();
                  } else {
                    delegateMutation.mutate();
                  }
                }}
              >
                <ShieldCheck className="mr-1.5 h-4 w-4" />
                {myDelegation ? "Revoke delegation" : "Delegate"}
              </Button>
            </div>
          ) : null}

          {/* BLOCK, MUTE AND REPORT FROM HERE.
              These were only ever reachable from a post's menu, so somebody who
              had never posted could not be blocked at all — which is precisely
              the person most likely to need blocking. */}
          {!isSelf ? (
            <div className="mt-3 flex w-full max-w-sm items-center justify-center gap-4 text-xs">
              <button
                type="button"
                className="text-slate-400 underline-offset-2 hover:text-white hover:underline"
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to mute people.");
                    return;
                  }
                  safetyApi
                    .mute(id!)
                    .then(() =>
                      toast.success("Muted", {
                        description: "Their posts will not appear in your feed.",
                      }),
                    )
                    .catch(() => toast.error("Couldn't mute them"));
                }}
              >
                Mute
              </button>

              <button
                type="button"
                className="text-slate-400 underline-offset-2 hover:text-white hover:underline"
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to report people.");
                    return;
                  }
                  safetyApi
                    .report({ userId: id!, reason: "other" })
                    .then(() =>
                      toast.success("Reported", {
                        description: "A moderator will look at this.",
                      }),
                    )
                    .catch(() => toast.error("Couldn't send the report"));
                }}
              >
                Report
              </button>

              <button
                type="button"
                className="text-oppose underline-offset-2 hover:underline"
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to block people.");
                    return;
                  }
                  if (
                    !window.confirm(
                      "Block this person? You will not see each other, and any follows or delegations between you end. They are not told.",
                    )
                  ) {
                    return;
                  }
                  safetyApi
                    .block(id!)
                    .then(() => {
                      toast.success("Blocked");
                      navigate("/people");
                    })
                    .catch(() => toast.error("Couldn't block them"));
                }}
              >
                Block
              </button>
            </div>
          ) : null}
        </div>

        {/* Their timeline */}
        <div className="px-4 pb-8">
          <h2 className="mb-3 text-lg font-semibold text-white">
            {isSelf ? "Your timeline" : `${profile.displayName.split(" ")[0]}'s timeline`}
          </h2>
          {postsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            </div>
          ) : posts.length === 0 ? (
            <div className="rounded-xl border border-slate-700/30 bg-slate-800/40 p-8 text-center">
              <p className="text-slate-400">No posts yet</p>
            </div>
          ) : (
            posts.map((post) => (
              <div
                key={post.id}
                className="mb-3 rounded-xl border border-slate-700/40 bg-slate-800/60 p-4"
              >
                <p className="whitespace-pre-wrap break-words text-slate-200">{post.content}</p>
                {post.referenceTitle ? (
                  <button
                    onClick={() => navigate(referenceRoute(post))}
                    className="mt-3 flex w-full items-center rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-2 text-left transition-colors hover:bg-slate-900"
                  >
                    <FileText size={14} className="mr-2 shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-300">
                      {post.referenceTitle}
                    </span>
                    <Badge variant="secondary" className="ml-2 shrink-0 text-[10px] capitalize">
                      {(post.referenceType ?? "bill").replace(/_/g, " ")}
                    </Badge>
                  </button>
                ) : null}
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(post.createdAt).toLocaleString()} · {post.likesCount} likes ·{" "}
                  {post.commentsCount} comments
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
