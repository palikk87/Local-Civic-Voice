// Public profile — any user's profile and personal timeline (their own posts
// and shares), with follow and delegate actions. Mobile twin: mobile/src/app/user/[id].tsx
// Data: GET /api/users/:id, GET /api/posts?authorId=:id, POST /api/users/:id/follow,
// POST /api/delegations (server enforces earned delegate eligibility).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  FileText,
  Loader2,
  MapPin,
  ShieldCheck,
  MessageCircle,
  UserMinus,
  UserPlus,
  Gavel,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";
import { api } from "@/lib/api";
import { failureMessage } from "@/lib/request-failure";
import { safetyApi } from "@/lib/civic";
import { CommonGround } from "@/components/civic/CommonGround";
import { ImpeachmentRecord } from "@/components/profile/ImpeachmentRecord";
import { FindingsRecord } from "@/components/profile/FindingsRecord";
import { DelegateAuditPanel } from "@/components/audit/IntegrityAuditPanel";
import { TrustPanel } from "@/components/trust/TrustPanel";
import { FileAgainstDelegate } from "@/components/articlev/FileArticles";
import type { MyDelegation } from "@/lib/article-v";
import { CivicRecord } from "@/components/record/CivicRecord";
import { ReportDialog } from "@/components/safety/ReportDialog";
import { useStartConversation } from "@/lib/api/messages";
import { PostComments } from "@/components/feed/PostComments";

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

// The delegation shape comes from lib/article-v, which is also what the
// filing form takes. This file used to declare a narrower local copy with
// three of its fields, which was fine until the same object had to be handed
// to something that needed the rest of them.

function referenceRoute(post: UserPost): string {
  // One law, one page — see the note in Feed.tsx. The three branch-specific
  // screens were ports of the phone app and are redirects now.
  return `/reference/${post.referenceId ?? ""}`;
}

export default function UserProfile() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user: me, isAuthenticated } = useCurrentUser();
  const { openAuth } = useAuthUI();
  const isSelf = me?.id === id;
  const startConversation = useStartConversation();
  const [reporting, setReporting] = useState(false);
  /** One thread open at a time on a profile — a wall of open boxes is noise. */
  const [openComments, setOpenComments] = useState<string | null>(null);

  const { data: profile, isLoading, isError, error, refetch } = useQuery({
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
  /*
   * Optional all the way down, not just past `friendsData`.
   *
   * `friendsData?.pagination.total` guards the response and then dereferences
   * `pagination` unconditionally, so any answer without that key threw and the
   * ENTIRE PROFILE went to the error boundary — a blank page, because a number
   * next to the word "Friends" could not be read. One count is not worth a page.
   */
  const friendCount = friendsData?.pagination?.total ?? 0;

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

  // A DELETED ACCOUNT IS NOT A SLOW ONE — AND NEITHER IS AN UNREACHABLE SERVER.
  //
  // This used to fold "no profile" into the loading branch, so a link to an
  // account that no longer exists spun a loader forever. Nothing was coming.
  // Say so, and give them somewhere to go.
  //
  // Then it folded something else in: `isError` covers a dead socket as well as
  // a 404, so with the API unreachable this page told readers that a real
  // person's account had been deleted. It had not. Nobody had asked anybody.
  // Measured — see docs/IF_THE_API_HOST_GOES_AWAY.md.
  if (isError || !profile) {
    const failure = failureMessage(error, "this account");
    return (
      <AppShell>
        <div className="mx-auto max-w-md py-24 text-center">
          <h1 className="font-display text-xl font-semibold text-foreground">{failure.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{failure.detail}</p>
          {failure.canRetry ? (
            <Button className="mt-6" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          ) : (
            <Button className="mt-6" variant="outline" onClick={() => navigate("/")}>
              Back to the feed
            </Button>
          )}
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
            {/* A citizen's positions are public. That is the premise: this
                platform asks for public positions on public business, and a
                position nobody can look up is a poll answer.

                Somebody else's list is a page again, reached by a deliberate
                click; your own stays in place below. See the bug report in
                CivicRecord for why. */}
            {isSelf ? (
              <a href="#record" className="flex flex-col items-center">
                <span className="text-lg font-bold text-white">{profile.votesCount}</span>
                <span className="text-sm text-slate-400 underline-offset-2 hover:underline">
                  Positions
                </span>
              </a>
            ) : (
              <Link to={`/user/${id}/record`} className="flex flex-col items-center">
                <span className="text-lg font-bold text-white">{profile.votesCount}</span>
                <span className="text-sm text-slate-400 underline-offset-2 hover:underline">
                  Positions
                </span>
              </Link>
            )}
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
              {/* MESSAGE. There was no way to start a conversation with
                  somebody from their profile — the only route into a thread was
                  a thread that already existed, so two people who had never
                  spoken could not begin. The backend returns the existing
                  conversation when there is one, so this is safe to press
                  twice. */}
              <Button
                className="flex-1"
                variant="outline"
                disabled={startConversation.isPending}
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to send a message.");
                    return;
                  }
                  startConversation.mutate(
                    { participantId: id! },
                    {
                      onSuccess: (data) => navigate(`/conversation/${data.conversation.id}`),
                      onError: () => toast.error("Couldn't open a conversation"),
                    },
                  );
                }}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" />
                Message
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

              {/* IT USED TO FIRE INSTANTLY, with the reason hardcoded to
                  "other" and nothing written, and then claim a moderator would
                  look at it. Nobody could act on a report that said "other"
                  about nothing in particular. It opens a form now. */}
              <button
                type="button"
                data-testid="report-user"
                className="text-slate-400 underline-offset-2 hover:text-white hover:underline"
                onClick={() => {
                  if (!isAuthenticated) {
                    openAuth("Sign in to report people.");
                    return;
                  }
                  setReporting(true);
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

        {/* ARTICLE V. Above everything else about them, because somebody
            deciding whether to lend this person their vote needs to know
            before they read the rest — not after. Renders nothing at all for
            almost every profile. */}
        <div className="px-4">
          <ImpeachmentRecord userId={id!} />
        </div>

        {/* BILL OF RIGHTS ARTICLE V. Beside the impeachment record, for the
            same reason: somebody deciding whether to lend this person their
            vote is entitled to know what a jury found about how they used one. */}
        <div className="px-4">
          <FindingsRecord userId={id!} />
        </div>

        {/* ARTICLE III §2, where the support actually is. Somebody weighing up
            whether to lend this person their vote can check the support they
            already carry, in counts, without seeing a single name. */}
        {/* THE TRUST SCORE. Everything it is made of, on the same panel —
            it exists to inform a decision, not to be believed. */}
        <div className="px-4 pb-4">
          <TrustPanel userId={id!} />
        </div>

        <div className="px-4">
          <DelegateAuditPanel userId={id!} />
        </div>

        {/* BRINGING PROCEEDINGS, WHERE THE PERSON IS.
            Only shown to somebody who currently delegates to them, which is
            the same bar the server enforces — and it is exactly the person
            entitled to bring it. Before this, the only way in was a card on
            your own profile leading to a page most people never open, so the
            remedy existed and could not be found. */}
        {myDelegation ? (
          <div className="px-4">
            <div className="mb-2 flex items-center gap-2">
              <Gavel className="h-4 w-4 text-red-500" />
              <h2 className="text-sm font-semibold text-foreground">
                You lend this person your vote
              </h2>
            </div>
            <p className="mb-3 text-xs leading-5 text-muted-foreground">
              You can take it back on your own at any time, with the button above. Article V is
              the other route: if you think everybody who lends to them should decide together,
              file Articles of Impeachment and all of their current delegators vote on it.
            </p>
            <FileAgainstDelegate
              delegation={myDelegation}
              minLength={40}
              maxLength={5000}
              onFiled={() => {
                toast.success("Articles of Impeachment filed", {
                  description:
                    "Every current delegator has been notified, and the person named has been served.",
                });
                navigate("/article-v");
              }}
            />
          </div>
        ) : null}

        {/* Where the two of you actually agree — and where you do not. Sits
            above their timeline: knowing you are with somebody on three
            records changes how their posts read. */}
        {isSelf ? null : <CommonGround userId={id!} name={profile.displayName} />}

        {/* THEIR RECORD — the whole point of a public profile here.
            Until now this page showed a bio, follower counts and a list of
            posts: everything a generic social profile shows and nothing this
            platform exists for. Positions are public; the anonymous ones are
            withheld from everybody but their author, and the two private
            sections do not render for a visitor.

            A visitor gets the counts and a way through. You get the whole
            thing, because it is yours. See the component. */}
        <div id="record" className="scroll-mt-4 px-4 pb-8">
          <CivicRecord userId={id} isMine={isSelf} variant={isSelf ? "full" : "summary"} />
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
                {/*
                  THE COMMENT COUNT IS A DOOR NOW.

                  It was a sentence. Somebody reading a profile could see that a
                  post had eleven comments and had no way to read one, let alone
                  add one, without hunting for the post somewhere else. Asked
                  for as "keep people on the feed or profile pages or where ever
                  they are that they see the post and still comment".
                */}
                <p className="mt-2 text-xs text-slate-500">
                  {new Date(post.createdAt).toLocaleString()} · {post.likesCount} likes ·{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setOpenComments((open) => (open === post.id ? null : post.id))
                    }
                    aria-expanded={openComments === post.id}
                    className="underline underline-offset-2 hover:text-slate-300"
                  >
                    {post.commentsCount} comments
                  </button>
                </p>
                {openComments === post.id ? <PostComments postId={post.id} autoFocus /> : null}
              </div>
            ))
          )}
        </div>
      </div>

      <ReportDialog
        target={
          profile ? { userId: profile.id, what: `@${profile.username}` } : null
        }
        open={reporting}
        onOpenChange={setReporting}
      />
    </AppShell>
  );
}
