// Web port of mobile/src/app/(tabs)/timeline.tsx
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Heart,
  MessageCircle,
  Share2,
  Repeat2,
  Mail,
  Bell,
  MoreHorizontal,
  FileText,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  UserPlus,
  UserCheck,
  Scale,
  Landmark,
  TrendingUp,
  ChevronRight,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { MotionDiv } from "@/components/civic/Motion";
import { AppShell } from "@/components/layout/AppShell";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  useTimelineStore,
  selectPosts,
  selectUnreadCount,
  type TimelinePost,
  type ContentType,
} from "@/lib/mobile/timeline-store";
import {
  useNotificationStore,
  selectUnreadCount as selectNotificationUnreadCount,
} from "@/lib/mobile/notification-store";
import {
  useGlobalEngagementStore,
  type ReferenceType,
} from "@/lib/mobile/global-engagement-store";
import CreatePostModal from "@/components/mobile/CreatePostModal";
import { ComposeCard } from "@/components/feed/ComposeCard";
import ShareModal from "@/components/mobile/ShareModal";
import PostOptionsModal from "@/components/mobile/PostOptionsModal";
import CommentSection, { parseContentWithMentions } from "@/components/mobile/CommentSection";
import { castReferenceVote } from "@/lib/mobile/reference-votes";
import { useCurrentUser, useRequireAuth } from "@/hooks/use-civic-auth";
import GlobalPulseDrawer from "@/components/mobile/GlobalPulseDrawer";
import { cn } from "@/lib/utils";

// Time ago helper
function getTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Format large numbers
function formatCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Map content types to reference types
function getRefTypeFromContentType(contentType: ContentType): ReferenceType | null {
  switch (contentType) {
    case "bill":
      return "bill";
    case "executive_order":
      return "executive_order";
    case "scotus_case":
      return "scotus_case";
    default:
      return null;
  }
}

// Content type icons and colors
const contentTypeConfig: Record<ContentType, { color: string; label: string }> = {
  bill: { color: "#3B82F6", label: "Bill" },
  executive_order: { color: "#F59E0B", label: "Executive Order" },
  scotus_case: { color: "#8B5CF6", label: "Court Case" },
  text: { color: "#64748B", label: "Post" },
};

// Branch labels and colors (matching Feed)
const branchLabels: Record<string, string> = {
  legislative: "Congress",
  executive: "Executive",
  judicial: "Supreme Court",
};

const branchColors: Record<string, string> = {
  legislative: "#3B82F6",
  executive: "#F59E0B",
  judicial: "#8B5CF6",
};

// Category colors (matching Feed)
const categoryColors: Record<string, string> = {
  healthcare: "#EF4444",
  economy: "#22C55E",
  education: "#3B82F6",
  environment: "#10B981",
  defense: "#6366F1",
  immigration: "#F59E0B",
  infrastructure: "#8B5CF6",
  civil_rights: "#EC4899",
  technology: "#06B6D4",
  foreign_policy: "#F97316",
};

const categoryLabels: Record<string, string> = {
  healthcare: "Healthcare",
  economy: "Economy",
  education: "Education",
  environment: "Environment",
  defense: "Defense",
  immigration: "Immigration",
  infrastructure: "Infrastructure",
  civil_rights: "Civil Rights",
  technology: "Technology",
  foreign_policy: "Foreign Policy",
};

// Branch Badge Component (matching Feed)
function BranchBadge({ branch }: { branch?: string }) {
  const branchType = branch ?? "legislative";
  const color = branchColors[branchType] ?? "#3B82F6";
  const label = branchLabels[branchType] ?? "Congress";

  return (
    <div
      className="flex items-center px-2 py-0.5 rounded-full mr-2"
      style={{ backgroundColor: `${color}20` }}
    >
      {branchType === "legislative" ? <Landmark size={10} color={color} /> : null}
      {branchType === "executive" ? <FileText size={10} color={color} /> : null}
      {branchType === "judicial" ? <Scale size={10} color={color} /> : null}
      <span className="text-xs font-medium ml-1" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// Single post component with full feature parity
function PostCard({
  post,
  index,
  onComment,
  onShare,
  onMore,
}: {
  post: TimelinePost;
  index: number;
  onComment: (post: TimelinePost) => void;
  onShare: (post: TimelinePost) => void;
  onMore: (post: TimelinePost) => void;
}) {
  const navigate = useNavigate();
  const [briefExpanded, setBriefExpanded] = useState(false);
  const likePost = useTimelineStore((s) => s.likePost);
  const voteOnPost = useTimelineStore((s) => s.voteOnPost);
  const followAuthor = useTimelineStore((s) => s.followAuthor);
  const unfollowAuthor = useTimelineStore((s) => s.unfollowAuthor);

  // Global engagement - for posts with reference IDs
  const referenceId = post.sharedContent?.id;
  const globalEngagement = useGlobalEngagementStore((s) =>
    referenceId ? s.getGlobalEngagement(referenceId) : undefined
  );
  const globalUserVote = useGlobalEngagementStore((s) =>
    referenceId ? s.getUserVote(referenceId) : undefined
  );
  const voteOnReference = useGlobalEngagementStore((s) => s.voteOnReference);
  const requireAuth = useRequireAuth();
  const { user: signedInUser } = useCurrentUser();
  const signedInUserId = signedInUser?.id;

  // Check if this is a library post (define early for use in handlers)
  const isLibraryPost = post.source === "library";

  // A post whose attachment came back from the server carries the printed id.
  // Those votes must go to the shared reference record; anything else is a
  // local-only post and keeps the in-store counters.
  const hasServerReference = Boolean(post.sharedContent?.displayId);

  const handleLike = () => {
    if (!requireAuth("Sign in to like posts.")) return;
    likePost(post.id);
  };

  const castVote = (vote: "support" | "oppose") => {
    if (!requireAuth("Sign in to add your voice to the Public Pulse.")) return;

    if (hasServerReference && referenceId) {
      // Real law, real vote: recorded once on the law's central record, shown
      // on every card that carries it.
      void castReferenceVote(referenceId, vote).catch(() => {
        toast.error("Could not record your vote. Please try again.");
      });
      return;
    }

    // Local-only post: keep the in-store counters.
    voteOnPost(post.id, vote);
    if (referenceId) {
      voteOnReference(referenceId, vote, post.id, post.author.id);
    }
  };

  const handleSupport = () => castVote("support");
  const handleOppose = () => castVote("oppose");

  const handleFollow = () => {
    if (!requireAuth("Sign in to follow other citizens.")) return;
    if (post.author.isFollowing) {
      unfollowAuthor(post.author.id);
    } else {
      followAuthor(post.author.id);
    }
  };

  const handleViewContent = () => {
    // Navigate to internal detail pages for all posts (including library posts)
    if (post.sharedContent?.id) {
      switch (post.contentType) {
        case "bill":
          navigate(`/bill/${post.sharedContent.id}`);
          break;
        case "executive_order":
          navigate(`/executive-order/${post.sharedContent.id}`);
          break;
        case "scotus_case":
          navigate(`/scotus/${post.sharedContent.id}`);
          break;
        default:
          navigate(`/bill/${post.sharedContent.id}`);
      }
    }
  };

  const timeAgo = getTimeAgo(post.createdAt);
  // Own-post checks must use the signed-in account, not the demo profile —
  // otherwise Follow shows on your own posts and never on anyone else's.
  const isOwnPost = post.author.id === signedInUserId;
  const contentConfig = contentTypeConfig[post.contentType] ?? contentTypeConfig.text;

  // Use global engagement counts if available, otherwise fall back to local.
  // Server-backed posts always use the server's tally — the local mirror would
  // otherwise mask the authoritative numbers the moment someone votes.
  const hasGlobalEngagement = !hasServerReference && globalEngagement !== undefined;
  const supportCount = hasGlobalEngagement
    ? globalEngagement.supportVotes
    : post.voteCounts?.support ?? 0;
  const opposeCount = hasGlobalEngagement
    ? globalEngagement.opposeVotes
    : post.voteCounts?.oppose ?? 0;
  const userVote = globalUserVote?.vote ?? post.voteCounts?.userVote;
  const hasVoteCounts = post.voteCounts !== undefined;

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.05 }}
      className="mb-4 bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden"
    >
      {/* Library source indicator */}
      {isLibraryPost ? (
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <div className="flex items-center">
            <div
              className="w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: contentConfig.color }}
            />
            <span style={{ color: contentConfig.color }} className="text-xs font-medium">
              {/* The printed id when we have it — these cards now cover posts written
                  in the composer too, not just library shares. */}
              {post.sharedContent?.displayId
                ? `${contentConfig.label} · ${post.sharedContent.displayId}`
                : `${contentConfig.label} from Library`}
            </span>
          </div>
          {post.sharedContent?.sourceUrl ? (
            <a
              href={post.sharedContent.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center"
            >
              <ExternalLink size={12} color="#64748B" />
              <span className="text-slate-500 text-xs ml-1">Source</span>
            </a>
          ) : null}
        </div>
      ) : null}

      {/*
        The law under this post has changed since it was written.

        The post itself is untouched — the author's words stay theirs. This says
        the text being argued about is no longer the text that was argued about,
        which is the honest thing to tell a reader arriving months later.

        The server decides "since", so web and mobile cannot disagree about it.
      */}
      {post.sharedContent?.lawUpdatedSincePosting ? (
        <div className="flex items-center gap-1.5 px-4 pb-1">
          <History size={12} color="#F59E0B" />
          <span className="text-amber-500 text-xs">
            This law has been updated since this was posted
          </span>
        </div>
      ) : null}

      {/* Repost indicator (for non-library shares) */}
      {!isLibraryPost && post.type === "share" && post.sharedContent?.originalAuthor ? (
        <div className="flex items-center px-4 pt-3 pb-1">
          <Repeat2 size={14} color="#64748B" />
          <span className="text-slate-500 text-xs ml-2">{post.author.displayName} shared</span>
        </div>
      ) : null}

      {/* Author header with Follow button */}
      <div className="flex items-center p-4 pb-2">
        <img src={post.author.avatar} alt={post.author.displayName} className="w-12 h-12 rounded-full" />
        <div className="flex-1 ml-3 min-w-0">
          <div className="flex items-center">
            <span className="text-white font-semibold">{post.author.displayName}</span>
            <span className="text-slate-500 text-sm ml-2">· {timeAgo}</span>
          </div>
          <span className="text-slate-400 text-sm">@{post.author.username}</span>
        </div>

        {/* Follow button - show for other users' posts */}
        {!isOwnPost ? (
          <button
            onClick={handleFollow}
            className={cn(
              "flex items-center px-3 py-1.5 rounded-full mr-2 shrink-0",
              post.author.isFollowing ? "bg-slate-700" : "bg-amber-500"
            )}
          >
            {post.author.isFollowing ? (
              <>
                <UserCheck size={14} color="#94A3B8" />
                <span className="text-slate-300 text-xs ml-1">Following</span>
              </>
            ) : (
              <>
                <UserPlus size={14} color="#000" />
                <span className="text-slate-900 text-xs font-medium ml-1">Follow</span>
              </>
            )}
          </button>
        ) : null}

        <button onClick={() => onMore(post)} className="p-2 shrink-0">
          <MoreHorizontal size={20} color="#64748B" />
        </button>
      </div>

      {/* Content */}
      <div className="px-4">
        {/* AI Brief (for library posts) - Compact with expand option */}
        {post.aiBrief ? (
          <button
            onClick={() => setBriefExpanded(!briefExpanded)}
            className="w-full text-left bg-slate-700/40 rounded-lg p-3 mb-3 border-l-2 border-amber-500"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-amber-500 text-xs font-medium">CITIZEN'S BRIEF</span>
              {!briefExpanded && post.aiBrief.length > 150 ? (
                <span className="text-amber-500/70 text-xs">Tap to expand</span>
              ) : null}
            </div>
            <p
              className={cn(
                "text-white text-base leading-relaxed",
                !briefExpanded && "line-clamp-3"
              )}
            >
              {post.aiBrief}
            </p>
            {!briefExpanded && post.aiBrief.length > 150 ? (
              <p className="text-amber-500 text-sm mt-1 font-medium">Read more</p>
            ) : null}
            {briefExpanded && post.aiBrief.length > 150 ? (
              <p className="text-slate-400 text-sm mt-1">Show less</p>
            ) : null}
          </button>
        ) : null}

        {/* User's opinion on shared content */}
        {post.opinion && !post.aiBrief ? (
          <p className="text-white text-base mb-3 leading-relaxed">{post.opinion}</p>
        ) : null}

        {/* Original text post */}
        {post.type === "original" && post.content && !post.aiBrief ? (
          <p className="text-white text-base mb-3 leading-relaxed">{post.content}</p>
        ) : null}

        {/* Shared content preview - Library post (matching Feed style) */}
        {isLibraryPost && post.sharedContent ? (
          <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/30 mb-3">
            {/* Branch and Category Badges Row */}
            <div className="flex items-center flex-wrap mb-2">
              <BranchBadge
                branch={
                  post.contentType === "bill"
                    ? "legislative"
                    : post.contentType === "executive_order"
                    ? "executive"
                    : post.contentType === "scotus_case"
                    ? "judicial"
                    : "legislative"
                }
              />

              {post.sharedContent.category ? (
                <div
                  className="px-2 py-0.5 rounded-full mr-2"
                  style={{
                    backgroundColor: `${categoryColors[post.sharedContent.category] ?? "#64748B"}30`,
                  }}
                >
                  <span
                    style={{ color: categoryColors[post.sharedContent.category] ?? "#64748B" }}
                    className="text-xs font-medium"
                  >
                    {categoryLabels[post.sharedContent.category] ??
                      post.sharedContent.category.replace("_", " ")}
                  </span>
                </div>
              ) : null}
            </div>

            {/* Title */}
            <p className="text-white font-semibold text-base mb-1 line-clamp-2">
              {post.sharedContent.title}
            </p>

            {/* Vote Progress Bar (matching Feed style) */}
            {hasVoteCounts || hasGlobalEngagement ? (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">
                    {formatCount(supportCount + opposeCount)} community votes
                  </span>
                  <button onClick={handleViewContent} className="flex items-center">
                    <span className="text-xs text-amber-500 mr-1">See details</span>
                    <ChevronRight size={12} color="#F59E0B" />
                  </button>
                </div>

                {/* Vote Progress Bar */}
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full bg-emerald-500 rounded-l-full"
                    style={{
                      width: `${
                        supportCount + opposeCount > 0
                          ? Math.round((supportCount / (supportCount + opposeCount)) * 100)
                          : 50
                      }%`,
                    }}
                  />
                </div>

                {/* Vote Buttons Row with Projected Outcome */}
                <div className="flex justify-between items-center">
                  <div className="flex items-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSupport();
                      }}
                      className={cn(
                        "flex items-center px-4 py-2 rounded-full mr-2",
                        userVote === "support" ? "bg-emerald-600" : "bg-slate-700"
                      )}
                    >
                      <ThumbsUp size={16} color={userVote === "support" ? "#fff" : "#22C55E"} />
                      <span
                        className={cn(
                          "ml-2 font-semibold",
                          userVote === "support" ? "text-white" : "text-emerald-500"
                        )}
                      >
                        Yea{" "}
                        {supportCount + opposeCount > 0
                          ? Math.round((supportCount / (supportCount + opposeCount)) * 100)
                          : 50}
                        %
                      </span>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOppose();
                      }}
                      className={cn(
                        "flex items-center px-4 py-2 rounded-full",
                        userVote === "oppose" ? "bg-red-600" : "bg-slate-700"
                      )}
                    >
                      <ThumbsDown size={16} color={userVote === "oppose" ? "#fff" : "#EF4444"} />
                      <span
                        className={cn(
                          "ml-2 font-semibold",
                          userVote === "oppose" ? "text-white" : "text-red-500"
                        )}
                      >
                        Nay{" "}
                        {supportCount + opposeCount > 0
                          ? Math.round((opposeCount / (supportCount + opposeCount)) * 100)
                          : 50}
                        %
                      </span>
                    </button>
                  </div>

                  {/* Projected Outcome Badge */}
                  <div
                    className={cn(
                      "px-2 py-1 rounded-full",
                      supportCount > opposeCount
                        ? "bg-emerald-900/50"
                        : opposeCount > supportCount
                        ? "bg-red-900/50"
                        : "bg-slate-700"
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium",
                        supportCount > opposeCount
                          ? "text-emerald-400"
                          : opposeCount > supportCount
                          ? "text-red-400"
                          : "text-slate-400"
                      )}
                    >
                      {supportCount > opposeCount
                        ? "Likely Pass"
                        : opposeCount > supportCount
                        ? "Likely Fail"
                        : "Uncertain"}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}


        {/* Shared text post (no bill data, non-library) */}
        {!isLibraryPost && post.type === "share" && post.sharedContent ? (
          <div className="bg-slate-700/60 rounded-xl p-4 border border-slate-600/50 mb-3">
            {post.sharedContent.originalAuthor ? (
              <div className="flex items-center mb-2">
                <img
                  src={post.sharedContent.originalAuthor.avatar}
                  alt={post.sharedContent.originalAuthor.displayName}
                  className="w-6 h-6 rounded-full"
                />
                <span className="text-slate-400 text-sm ml-2">
                  {post.sharedContent.originalAuthor.displayName}
                </span>
                <span className="text-slate-500 text-sm ml-1">
                  @{post.sharedContent.originalAuthor.username}
                </span>
              </div>
            ) : null}
            <p className="text-white text-base leading-relaxed">
              {post.content || post.sharedContent.title}
            </p>
          </div>
        ) : null}
      </div>

      {/* Actions - matching Feed style */}
      <div className="flex items-center px-4 py-3 border-t border-slate-700/30">
        {/* Like */}
        <button onClick={handleLike} className="flex items-center mr-6">
          <Heart
            size={18}
            color={post.isLiked ? "#EF4444" : "#64748B"}
            fill={post.isLiked ? "#EF4444" : "transparent"}
          />
          <span className={cn("ml-1.5 text-sm", post.isLiked ? "text-red-500" : "text-slate-400")}>
            {post.likes > 0 ? post.likes : ""}
          </span>
        </button>

        {/* Reply */}
        <button onClick={() => onComment(post)} className="flex items-center mr-6">
          <MessageCircle size={18} color="#64748B" />
          <span className="ml-1.5 text-slate-400 text-sm">Reply</span>
        </button>

        {/* Share */}
        <button onClick={() => onShare(post)} className="flex items-center">
          <Share2 size={18} color="#64748B" />
          <span className="ml-1.5 text-slate-400 text-sm">Share</span>
        </button>
      </div>

      {/* Comments preview */}
      {post.comments.length > 0 ? (
        <div className="px-4 pb-3 border-t border-slate-700/30 pt-3">
          {post.comments.slice(0, 2).map((comment) => (
            <div key={comment.id} className="flex mb-2">
              <img src={comment.author.avatar} alt={comment.author.displayName} className="w-8 h-8 rounded-full" />
              <div className="flex-1 ml-2 bg-slate-700/40 rounded-xl rounded-tl-sm px-3 py-2">
                <p className="text-white text-sm font-medium">{comment.author.displayName}</p>
                {parseContentWithMentions(comment.content, comment.taggedUsers)}
              </div>
            </div>
          ))}
          {post.comments.length > 2 ? (
            <button onClick={() => onComment(post)}>
              <span className="text-amber-500 text-sm font-medium">
                View all {post.comments.length} comments
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </MotionDiv>
  );
}

// Post detail modal with full comments
function PostDetailModal({
  post,
  visible,
  onClose,
}: {
  post: TimelinePost | null;
  visible: boolean;
  onClose: () => void;
}) {
  if (!post) return null;

  return (
    <Dialog open={visible} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="bg-slate-900 border-slate-800 p-0 max-w-lg w-full h-[90vh] flex flex-col overflow-hidden [&>button]:hidden bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <button onClick={onClose} className="text-slate-400">
            Close
          </button>
          <span className="text-white font-semibold">Post</span>
          <div className="w-12" />
        </div>

        {/* Post content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-0 pt-4">
            <PostCard post={post} index={0} onComment={() => undefined} onShare={() => undefined} onMore={() => undefined} />
          </div>
          <div className="border-t border-slate-800">
            <CommentSection postId={post.id} comments={post.comments} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TimelineScreen() {
  const navigate = useNavigate();
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<TimelinePost | null>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showGlobalPulse, setShowGlobalPulse] = useState(false);

  const posts = useTimelineStore(selectPosts);
  const unreadMessages = useTimelineStore(selectUnreadCount);
  const deletePost = useTimelineStore((s) => s.deletePost);
  const loadFeed = useTimelineStore((s) => s.loadFeed);
  const requireAuth = useRequireAuth();

  // Load the real feed on mount
  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // Notification store
  const notificationUnreadCount = useNotificationStore(selectNotificationUnreadCount);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);

  // Fetch notifications on mount
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Recalculate trending on mount
  const recalculateTrending = useGlobalEngagementStore((s) => s.recalculateTrendingScores);

  useEffect(() => {
    recalculateTrending();
  }, [recalculateTrending]);

  const handleComment = useCallback(
    (post: TimelinePost) => {
      if (!requireAuth("Sign in to join the conversation.")) return;
      setSelectedPost(post);
      setShowPostDetail(true);
    },
    [requireAuth]
  );

  const handleShare = useCallback(
    (post: TimelinePost) => {
      if (!requireAuth("Sign in to share this post.")) return;
      setSelectedPost(post);
      setShowShareModal(true);
    },
    [requireAuth]
  );

  const handleMore = useCallback((post: TimelinePost) => {
    setSelectedPost(post);
    setShowOptionsModal(true);
  }, []);

  const handleDeletePost = async (postId: string) => {
    if (!requireAuth("Sign in to manage your posts.")) return;
    if (!window.confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
      return;
    }

    // Awaited, and the post leaves the screen only once the server says it is
    // gone. The previous version removed it locally and never called the
    // server at all, so a "deleted" post stayed public and came back on the
    // next reload — with the user believing they had taken it down.
    try {
      await deletePost(postId);
      setShowOptionsModal(false);
      toast.success("Post deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete the post. It is still up.",
      );
    }
  };

  const handleReportPost = () => {
    if (!requireAuth("Sign in to report a post.")) return;
    window.alert("Thank you for helping keep our community safe. This post has been reported for review.");
  };

  const handleBlockUser = () => {
    if (!requireAuth("Sign in to block this user.")) return;
    window.alert("You will no longer see posts from this user. They will not be notified.");
  };

  const handleMuteUser = () => {
    if (!requireAuth("Sign in to mute this user.")) return;
    window.alert("You will no longer see posts from this user in your feed.");
  };

  const handleMessages = () => {
    navigate("/messages");
  };

  const handleNotifications = () => {
    navigate("/notifications");
  };

  return (
    <AppShell>
      <div className="max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-1 py-3 mb-2">
          <h1 className="text-2xl font-bold text-white">Timeline</h1>
          <div className="flex items-center gap-2">
            {/* Global Pulse */}
            <button
              onClick={() => setShowGlobalPulse(true)}
              className="flex items-center bg-amber-500/20 px-3 py-2 rounded-full"
            >
              <TrendingUp size={16} color="#F59E0B" />
              <span className="text-amber-500 text-xs font-medium ml-1">Pulse</span>
            </button>

            {/* Notifications */}
            <button
              onClick={handleNotifications}
              className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center relative"
            >
              <Bell size={20} color="#94A3B8" />
              {notificationUnreadCount > 0 ? (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-slate-900 text-xs font-bold">
                  {notificationUnreadCount > 9 ? "9+" : notificationUnreadCount}
                </span>
              ) : null}
            </button>

            {/* Messages */}
            <button
              onClick={handleMessages}
              className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center relative"
            >
              <Mail size={20} color="#94A3B8" />
              {unreadMessages > 0 ? (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-slate-900 text-xs font-bold">
                  {unreadMessages}
                </span>
              ) : null}
            </button>

            {/* Create post */}
            <button
              onClick={() => setShowCreatePost(true)}
              className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center"
            >
              <Plus size={22} color="#0F172A" />
            </button>
          </div>
        </div>

        {/* Composer — posts attach to a canonical government reference */}
        <div className="px-1 pb-3">
          <ComposeCard />
        </div>

        {/* Feed */}
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mb-4">
              <MessageCircle size={36} color="#64748B" />
            </div>
            <p className="text-white font-semibold text-lg">No posts yet</p>
            <p className="text-slate-400 text-sm mt-1 text-center px-8">
              Be the first to share something with the community
            </p>
            <button
              onClick={() => setShowCreatePost(true)}
              className="mt-4 px-6 py-3 bg-amber-500 rounded-full"
            >
              <span className="text-slate-900 font-semibold">Create Post</span>
            </button>
          </div>
        ) : (
          <div>
            {posts.map((post, index) => (
              <PostCard
                key={post.id}
                post={post}
                index={index}
                onComment={handleComment}
                onShare={handleShare}
                onMore={handleMore}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreatePostModal visible={showCreatePost} onClose={() => setShowCreatePost(false)} />

      <ShareModal
        visible={showShareModal}
        onClose={() => {
          setShowShareModal(false);
          setSelectedPost(null);
        }}
        post={selectedPost ?? undefined}
      />

      <PostOptionsModal
        visible={showOptionsModal}
        onClose={() => {
          setShowOptionsModal(false);
          setSelectedPost(null);
        }}
        post={selectedPost}
        onDelete={handleDeletePost}
        onShare={(post) => {
          setShowOptionsModal(false);
          setSelectedPost(post);
          setShowShareModal(true);
        }}
        onReport={handleReportPost}
        onBlock={handleBlockUser}
        onMute={handleMuteUser}
      />

      <PostDetailModal
        post={selectedPost}
        visible={showPostDetail}
        onClose={() => {
          setShowPostDetail(false);
          setSelectedPost(null);
        }}
      />

      {/* Global Pulse Drawer */}
      <GlobalPulseDrawer visible={showGlobalPulse} onClose={() => setShowGlobalPulse(false)} />
    </AppShell>
  );
}
