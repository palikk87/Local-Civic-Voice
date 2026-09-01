import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  FlatList,
  RefreshControl,
  Modal,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
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
  Gavel,
  TrendingUp,
  Globe,
  ChevronRight,
  History,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {
  useTimelineStore,
  selectPosts,
  selectUnreadCount,
  type TimelinePost,
  type ContentType,
} from '@/lib/timeline-store';
import {
  useNotificationStore,
  selectUnreadCount as selectNotificationUnreadCount,
} from '@/lib/notification-store';
import {
  useGlobalEngagementStore,
  type ReferenceType,
} from '@/lib/global-engagement-store';
import { useCurrentUser } from '@/lib/auth/use-civic-auth';
import { castReferenceVote } from '@/lib/reference-votes';
import CreatePostModal from '@/components/CreatePostModal';
import ShareModal from '@/components/ShareModal';
import PostOptionsModal from '@/components/PostOptionsModal';
import { ReportSheet } from '@/components/ReportSheet';
import { safetyApi } from '@/lib/api/safety';
import { repostPost } from '@/lib/api/feed';
import CommentSection, { parseContentWithMentions } from '@/components/CommentSection';
import GlobalPulseDrawer from '@/components/GlobalPulseDrawer';
import { AuthGate } from '@/components/auth/AuthGate';
import { cn } from '@/lib/cn';
import { VoteButtons } from '@/components/VoteButtons';

// Time ago helper
function getTimeAgo(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    case 'bill':
      return 'bill';
    case 'executive_order':
      return 'executive_order';
    case 'scotus_case':
      return 'scotus_case';
    default:
      return null;
  }
}

// Content type icons and colors
const contentTypeConfig: Record<ContentType, { icon: 'landmark' | 'file' | 'scale'; color: string; label: string }> = {
  bill: { icon: 'landmark', color: '#3B82F6', label: 'Bill' },
  executive_order: { icon: 'file', color: '#F59E0B', label: 'Executive Order' },
  scotus_case: { icon: 'scale', color: '#8B5CF6', label: 'Court Case' },
  text: { icon: 'file', color: '#6E8A7C', label: 'Post' },
};

// Branch labels and colors (matching Feed)
const branchLabels: Record<string, string> = {
  legislative: 'Congress',
  executive: 'Executive',
  judicial: 'Supreme Court',
};

const branchColors: Record<string, string> = {
  legislative: '#3B82F6',
  executive: '#F59E0B',
  judicial: '#8B5CF6',
};

// Category colors (matching Feed)
const categoryColors: Record<string, string> = {
  healthcare: '#EF4444',
  economy: '#22C55E',
  education: '#3B82F6',
  environment: '#10B981',
  defense: '#6366F1',
  immigration: '#F59E0B',
  infrastructure: '#8B5CF6',
  civil_rights: '#EC4899',
  technology: '#06B6D4',
  foreign_policy: '#F97316',
};

const categoryLabels: Record<string, string> = {
  healthcare: 'Healthcare',
  economy: 'Economy',
  education: 'Education',
  environment: 'Environment',
  defense: 'Defense',
  immigration: 'Immigration',
  infrastructure: 'Infrastructure',
  civil_rights: 'Civil Rights',
  technology: 'Technology',
  foreign_policy: 'Foreign Policy',
};

// Branch Badge Component (matching Feed)
function BranchBadge({ branch }: { branch?: string }) {
  const branchType = branch ?? 'legislative';
  const color = branchColors[branchType] ?? '#3B82F6';
  const label = branchLabels[branchType] ?? 'Congress';

  return (
    <View
      className="flex-row items-center px-2 py-0.5 rounded-full mr-2"
      style={{ backgroundColor: `${color}20` }}
    >
      {branchType === 'legislative' && <Landmark size={10} color={color} />}
      {branchType === 'executive' && <FileText size={10} color={color} />}
      {branchType === 'judicial' && <Scale size={10} color={color} />}
      <Text className="text-xs font-medium ml-1" style={{ color }}>
        {label}
      </Text>
    </View>
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
  const router = useRouter();
  const [briefExpanded, setBriefExpanded] = useState(false);
  const likePost = useTimelineStore((s) => s.likePost);
  const voteOnPost = useTimelineStore((s) => s.voteOnPost);
  const followAuthor = useTimelineStore((s) => s.followAuthor);
  const unfollowAuthor = useTimelineStore((s) => s.unfollowAuthor);

  // Global engagement - for posts with reference IDs
  const referenceId = post.sharedContent?.id;
  const refType = getRefTypeFromContentType(post.contentType);
  const globalEngagement = useGlobalEngagementStore((s) =>
    referenceId ? s.getGlobalEngagement(referenceId) : undefined
  );
  const globalUserVote = useGlobalEngagementStore((s) =>
    referenceId ? s.getUserVote(referenceId) : undefined
  );
  const voteOnReference = useGlobalEngagementStore((s) => s.voteOnReference);
  const { user: signedInUser } = useCurrentUser();
  const signedInUserId = signedInUser?.id;

  // Check if this is a library post (define early for use in handlers)
  const isLibraryPost = post.source === 'library';

  // A post whose attachment came back from the server carries the printed id.
  // Those votes must go to the shared reference record; anything else is a
  // local-only post and keeps the in-store counters.
  const hasServerReference = Boolean(post.sharedContent?.displayId);

  const likeScale = useSharedValue(1);

  const likeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeScale.value }],
  }));

  const handleLike = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    likeScale.value = withSpring(1.3, { damping: 4 }, () => {
      likeScale.value = withSpring(1);
    });
    likePost(post.id);
  };

  // PASSING A POST ON. The one action whose entire purpose is reach: getting a
  // law in front of somebody who has not seen it. There was no way to do it but
  // to write your own post about the same law, which starts a second
  // conversation rather than joining the one already happening.
  const [reposted, setReposted] = useState(post.isRepostedByMe ?? false);
  const [reposts, setReposts] = useState(post.repostsCount ?? 0);

  const handleRepost = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !reposted;
    setReposted(next);
    setReposts((prev: number) => prev + (next ? 1 : -1));

    repostPost(post.repostOf?.id ?? post.id)
      .then((result) => {
        setReposted(Boolean(result?.reposted));
        setReposts(result?.repostsCount ?? 0);
      })
      .catch(() => {
        setReposted(!next);
        setReposts((prev: number) => prev + (next ? -1 : 1));
        Alert.alert("Couldn't pass it on", 'Please try again.');
      });
  };

  const castVote = (vote: 'support' | 'oppose') => {
    if (hasServerReference && referenceId) {
      // Real law, real vote: recorded once on the law's central record, shown
      // on every card that carries it.
      void castReferenceVote(referenceId, vote).catch(() => {
        Alert.alert('Vote not recorded', 'Could not record your vote. Please try again.', [
          { text: 'OK' },
        ]);
      });
      return;
    }

    // Local-only post: keep the in-store counters.
    voteOnPost(post.id, vote);
    if (referenceId) {
      voteOnReference(referenceId, vote, post.id, post.author.id);
    }
  };

  // The bounce and the haptic live in VoteButtons now, so this is only the vote.
  const handleSupport = () => {
    castVote('support');
  };

  const handleOppose = () => {
    castVote('oppose');
  };

  const handleFollow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
        case 'bill':
          router.push(`/bill/${post.sharedContent.id}`);
          break;
        case 'executive_order':
          router.push(`/executive-order/${post.sharedContent.id}`);
          break;
        case 'scotus_case':
          router.push(`/scotus/${post.sharedContent.id}`);
          break;
        default:
          router.push(`/bill/${post.sharedContent.id}`);
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
  const supportCount = hasGlobalEngagement ? globalEngagement.supportVotes : (post.voteCounts?.support ?? 0);
  const opposeCount = hasGlobalEngagement ? globalEngagement.opposeVotes : (post.voteCounts?.oppose ?? 0);
  const userVote = globalUserVote?.vote ?? post.voteCounts?.userVote;
  const hasVoteCounts = post.voteCounts !== undefined;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      className="mx-4 mb-4 bg-slate-800/60 rounded-2xl border border-slate-700/50 overflow-hidden"
    >
      {/* Library source indicator */}
      {isLibraryPost && (
        <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
          <View className="flex-row items-center">
            <View
              className="w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: contentConfig.color }}
            />
            {/* The printed id when we have it — these cards now cover posts written
                in the composer too, not just library shares. */}
            <Text style={{ color: contentConfig.color }} className="text-xs font-medium">
              {post.sharedContent?.displayId
                ? `${contentConfig.label} · ${post.sharedContent.displayId}`
                : `${contentConfig.label} from Library`}
            </Text>
          </View>
          {post.sharedContent?.sourceUrl && (
            <Pressable
              onPress={() => Linking.openURL(post.sharedContent?.sourceUrl ?? '')}
              className="flex-row items-center"
            >
              <ExternalLink size={12} color="#6E8A7C" />
              <Text className="text-slate-500 text-xs ml-1">Source</Text>
            </Pressable>
          )}
        </View>
      )}

      {/*
        The law under this post has changed since it was written.

        The post itself is untouched — the author's words stay theirs. This says
        the text being argued about is no longer the text that was argued about,
        which is the honest thing to tell a reader arriving months later.

        The server decides "since", so web and mobile cannot disagree about it.
      */}
      {post.sharedContent?.lawUpdatedSincePosting && (
        <View className="flex-row items-center px-4 pb-1">
          <History size={12} color="#F59E0B" />
          <Text className="text-amber-500 text-xs ml-1.5">
            This law has been updated since this was posted
          </Text>
        </View>
      )}

      {/* Repost indicator (for non-library shares) */}
      {!isLibraryPost && post.type === 'share' && post.sharedContent?.originalAuthor && (
        <View className="flex-row items-center px-4 pt-3 pb-1">
          <Repeat2 size={14} color="#6E8A7C" />
          <Text className="text-slate-500 text-xs ml-2">
            {post.author.displayName} shared
          </Text>
        </View>
      )}

      {/* Author header with Follow button.

          THE AUTHOR OF A POST WENT NOWHERE HERE — face, name and handle all
          inert, on the screen where people argue with each other. The web twin
          links all three. */}
      <View className="flex-row items-center p-4 pb-2">
        <Pressable onPress={() => router.push(`/user/${post.author.id}`)}>
          <Image
            source={{ uri: post.author.avatar }}
            className="w-12 h-12 rounded-full"
          />
        </Pressable>
        <View className="flex-1 ml-3">
          <View className="flex-row items-center">
            <Pressable onPress={() => router.push(`/user/${post.author.id}`)}>
              <Text className="text-white font-semibold">
                {post.author.displayName}
              </Text>
            </Pressable>
            {/* The timestamp is the permalink, the way it is everywhere else.
                Until now a post had no address at all and this was plain
                text. */}
            <Pressable onPress={() => router.push(`/post/${post.id}`)}>
              <Text className="text-slate-500 text-sm ml-2">· {timeAgo}</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => router.push(`/user/${post.author.id}`)}>
            <Text className="text-slate-400 text-sm">@{post.author.username}</Text>
          </Pressable>
        </View>

        {/* Follow button - show for other users' posts */}
        {!isOwnPost && (
          <Pressable
            onPress={handleFollow}
            className={cn(
              'flex-row items-center px-3 py-1.5 rounded-full mr-2',
              post.author.isFollowing ? 'bg-slate-700' : 'bg-amber-500'
            )}
          >
            {post.author.isFollowing ? (
              <>
                <UserCheck size={14} color="#8FA79A" />
                <Text className="text-slate-300 text-xs ml-1">Following</Text>
              </>
            ) : (
              <>
                <UserPlus size={14} color="#000" />
                <Text className="text-slate-900 text-xs font-medium ml-1">Follow</Text>
              </>
            )}
          </Pressable>
        )}

        <Pressable onPress={() => onMore(post)} className="p-2">
          <MoreHorizontal size={20} color="#6E8A7C" />
        </Pressable>
      </View>

      {/* Content */}
      <View className="px-4">
        {/* AI Brief (for library posts) - Compact with expand option */}
        {post.aiBrief && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setBriefExpanded(!briefExpanded);
            }}
            className="bg-slate-700/40 rounded-lg p-3 mb-3 border-l-2 border-amber-500"
          >
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-amber-500 text-xs font-medium">CITIZEN'S BRIEF</Text>
              {!briefExpanded && post.aiBrief.length > 150 && (
                <Text className="text-amber-500/70 text-xs">Tap to expand</Text>
              )}
            </View>
            <Text
              className="text-white text-base leading-relaxed"
              numberOfLines={briefExpanded ? undefined : 3}
            >
              {post.aiBrief}
            </Text>
            {!briefExpanded && post.aiBrief.length > 150 && (
              <Text className="text-amber-500 text-sm mt-1 font-medium">Read more</Text>
            )}
            {briefExpanded && post.aiBrief.length > 150 && (
              <Text className="text-slate-400 text-sm mt-1">Show less</Text>
            )}
          </Pressable>
        )}

        {/* User's opinion on shared content */}
        {post.opinion && !post.aiBrief && (
          <Text className="text-white text-base mb-3 leading-relaxed">
            {post.opinion}
          </Text>
        )}

        {/* Original text post */}
        {post.type === 'original' && post.content && !post.aiBrief && (
          <Text className="text-white text-base mb-3 leading-relaxed">
            {post.content}
          </Text>
        )}

        {/* Shared content preview - Library post (matching Feed style) */}
        {isLibraryPost && post.sharedContent && (
          <View className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/30 mb-3">
            {/* Branch and Category Badges Row */}
            <View className="flex-row items-center flex-wrap mb-2">
              {/* Branch Badge */}
              <BranchBadge branch={post.contentType === 'bill' ? 'legislative' : post.contentType === 'executive_order' ? 'executive' : post.contentType === 'scotus_case' ? 'judicial' : 'legislative'} />

              {/* Category Badge */}
              {post.sharedContent.category && (
                <View
                  className="px-2 py-0.5 rounded-full mr-2"
                  style={{ backgroundColor: `${categoryColors[post.sharedContent.category] ?? '#6E8A7C'}30` }}
                >
                  <Text
                    style={{ color: categoryColors[post.sharedContent.category] ?? '#6E8A7C' }}
                    className="text-xs font-medium"
                  >
                    {categoryLabels[post.sharedContent.category] ?? post.sharedContent.category.replace('_', ' ')}
                  </Text>
                </View>
              )}
            </View>

            {/* Title */}
            <Text className="text-white font-semibold text-base mb-1" numberOfLines={2}>
              {post.sharedContent.title}
            </Text>

            {/* Vote Progress Bar (matching Feed style) */}
            {(hasVoteCounts || hasGlobalEngagement) && (
              <View className="mt-3">
                <View className="flex-row items-center justify-between mb-2">
                  <Text className="text-xs text-slate-400">
                    {formatCount(supportCount + opposeCount)} community votes
                  </Text>
                  <Pressable onPress={handleViewContent} className="flex-row items-center">
                    <Text className="text-xs text-amber-500 mr-1">See details</Text>
                    <ChevronRight size={12} color="#F59E0B" />
                  </Pressable>
                </View>

                {/* Vote Progress Bar */}
                <View className="h-2 bg-slate-700 rounded-full overflow-hidden mb-3">
                  <View
                    className="h-full bg-emerald-500 rounded-l-full"
                    style={{ width: `${supportCount + opposeCount > 0 ? Math.round((supportCount / (supportCount + opposeCount)) * 100) : 50}%` }}
                  />
                </View>

                {/* Vote buttons */}
                <View className="flex-row justify-between items-center">
                  <View className="flex-row items-center">
                    <VoteButtons
                      size="sm"
                      userVote={userVote}
                      onAye={handleSupport}
                      onNay={handleOppose}
                      ayeLabel={`AYE ${supportCount + opposeCount > 0 ? Math.round((supportCount / (supportCount + opposeCount)) * 100) : 50}%`}
                      nayLabel={`NAY ${supportCount + opposeCount > 0 ? Math.round((opposeCount / (supportCount + opposeCount)) * 100) : 50}%`}
                    />
                  </View>

                  {/* THE "LIKELY PASS" BADGE IS GONE, AND NOT REPLACED.
                      It was computed from supportCount vs opposeCount — the
                      people on this platform who happened to have voted on
                      this post's law — and presented as a forecast of what
                      Congress will do. Eleven readers leaning yes is not a
                      prediction, and nothing on the badge said where the
                      claim came from because there was nowhere honest for it
                      to come from. The vote row above is the real number and
                      it is labelled as what it is: this platform's readers.
                      Web twin: apps/web/src/pages/Timeline.tsx. */}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Shared text post (no bill data, non-library) */}
        {!isLibraryPost && post.type === 'share' && post.sharedContent && (
          <View className="bg-slate-700/60 rounded-xl p-4 border border-slate-600/50 mb-3">
            {post.sharedContent.originalAuthor && (
              <View className="flex-row items-center mb-2">
                <Image
                  source={{ uri: post.sharedContent.originalAuthor.avatar }}
                  className="w-6 h-6 rounded-full"
                />
                <Text className="text-slate-400 text-sm ml-2">
                  {post.sharedContent.originalAuthor.displayName}
                </Text>
                <Text className="text-slate-500 text-sm ml-1">
                  @{post.sharedContent.originalAuthor.username}
                </Text>
              </View>
            )}
            <Text className="text-white text-base leading-relaxed">
              {post.content || post.sharedContent.title}
            </Text>
          </View>
        )}
      </View>

      {/* Actions - matching Feed style */}
      <View className="flex-row items-center px-4 py-3 border-t border-slate-700/30">
        {/* Like */}
        <Pressable onPress={handleLike} className="flex-row items-center mr-6">
          <Animated.View style={likeAnimatedStyle}>
            <Heart
              size={18}
              color={post.isLiked ? '#EF4444' : '#6E8A7C'}
              fill={post.isLiked ? '#EF4444' : 'transparent'}
            />
          </Animated.View>
          <Text className={cn('ml-1.5 text-sm', post.isLiked ? 'text-red-500' : 'text-slate-400')}>
            {post.likes > 0 ? post.likes : ''}
          </Text>
        </Pressable>

        {/* Reply */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onComment(post);
          }}
          className="flex-row items-center mr-6"
        >
          <MessageCircle size={18} color="#6E8A7C" />
          <Text className="ml-1.5 text-slate-400 text-sm">Reply</Text>
        </Pressable>

        {/* Repost */}
        <Pressable onPress={handleRepost} className="flex-row items-center mr-6">
          <Repeat2 size={18} color={reposted ? '#22C55E' : '#6E8A7C'} />
          <Text className={cn('ml-1.5 text-sm', reposted ? 'text-emerald-500' : 'text-slate-400')}>
            {reposts > 0 ? reposts : ''}
          </Text>
        </Pressable>

        {/* Share */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onShare(post);
          }}
          className="flex-row items-center"
        >
          <Share2 size={18} color="#6E8A7C" />
          <Text className="ml-1.5 text-slate-400 text-sm">Share</Text>
        </Pressable>
      </View>

      {/* Comments preview */}
      {post.comments.length > 0 && (
        <View className="px-4 pb-3 border-t border-slate-700/30 pt-3">
          {post.comments.slice(0, 2).map((comment) => (
            <View key={comment.id} className="flex-row mb-2">
              {/* The post's author above goes to their profile; the commenter
                  here did not. Same person, same platform, half a rule. */}
              <Pressable onPress={() => router.push(`/user/${comment.author.id}`)}>
                <Image source={{ uri: comment.author.avatar }} className="w-8 h-8 rounded-full" />
              </Pressable>
              <View className="flex-1 ml-2 bg-slate-700/40 rounded-xl rounded-tl-sm px-3 py-2">
                <Pressable onPress={() => router.push(`/user/${comment.author.id}`)}>
                  <Text className="text-white text-sm font-medium">{comment.author.displayName}</Text>
                </Pressable>
                {parseContentWithMentions(comment.content, comment.taggedUsers)}
              </View>
            </View>
          ))}
          {post.comments.length > 2 && (
            <Pressable onPress={() => router.push(`/post/${post.id}`)}>
              <Text className="text-amber-500 text-sm font-medium">
                View all {post.comments.length} comments
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </Animated.View>
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
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#0C1D18', '#17362A', '#0C1D18']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
            <Pressable onPress={onClose}>
              <Text className="text-slate-400">Close</Text>
            </Pressable>
            <Text className="text-white font-semibold">Post</Text>
            <View className="w-12" />
          </View>

          {/* Post content */}
          <FlatList
            data={[post]}
            keyExtractor={(item) => item.id}
            renderItem={() => null}
            ListHeaderComponent={
              <PostCard
                post={post}
                index={0}
                onComment={() => {}}
                onShare={() => {}}
                onMore={() => {}}
              />
            }
            ListFooterComponent={
              <View className="border-t border-slate-800">
                <CommentSection postId={post.id} comments={post.comments} />
              </View>
            }
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

/**
 * Timeline is a member-only screen — it's a personal feed of the people and bills you
 * follow. Guests get a sign-in wall, exactly like the web app's /timeline route.
 */
export default function TimelineScreen() {
  return (
    <AuthGate
      capability="viewTimeline"
      reason="Your timeline is your personal feed of the people and bills you follow."
    >
      <TimelineFeed />
    </AuthGate>
  );
}

function TimelineFeed() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [reportingPost, setReportingPost] = useState<string | null>(null);
  const [showOptionsModal, setShowOptionsModal] = useState(false);
  const [selectedPost, setSelectedPost] = useState<TimelinePost | null>(null);
  const [showPostDetail, setShowPostDetail] = useState(false);
  const [showGlobalPulse, setShowGlobalPulse] = useState(false);

  const posts = useTimelineStore(selectPosts);
  const unreadMessages = useTimelineStore(selectUnreadCount);
  const loadFeed = useTimelineStore((s) => s.loadFeed);
  const deletePost = useTimelineStore((s) => s.deletePost);

  // Notification store
  const notificationUnreadCount = useNotificationStore(selectNotificationUnreadCount);
  const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);

  // Fetch notifications on mount
  React.useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Load the real feed on mount
  React.useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  // Recalculate trending on mount
  const recalculateTrending = useGlobalEngagementStore((s) => s.recalculateTrendingScores);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFeed();
      recalculateTrending();
    } finally {
      setRefreshing(false);
    }
  }, [loadFeed, recalculateTrending]);

  const handleComment = (post: TimelinePost) => {
    setSelectedPost(post);
    setShowPostDetail(true);
  };

  const handleShare = (post: TimelinePost) => {
    setSelectedPost(post);
    setShowShareModal(true);
  };

  const handleMore = (post: TimelinePost) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPost(post);
    setShowOptionsModal(true);
  };

  const handleDeletePost = (postId: string) => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          // Awaited, and the post leaves the screen only once the server says
          // it is gone. This used to remove it locally without calling the
          // server at all, so a "deleted" post stayed public and reappeared on
          // the next load — with the user believing they had taken it down.
          onPress: () => {
            void (async () => {
              try {
                await deletePost(postId);
                setShowOptionsModal(false);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch (error) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert(
                  'Not deleted',
                  error instanceof Error
                    ? error.message
                    : 'Could not delete the post. It is still up.',
                );
              }
            })();
          },
        },
      ]
    );
  };

  // THESE USED TO LIE. Each popped an Alert saying the thing had happened —
  // "you will no longer see posts from this user" — while nothing was recorded
  // anywhere. Somebody being harassed pressed Block and believed it.
  //
  // Each now calls the endpoint, says so only when it succeeded, and says so
  // plainly when it did not.

  // FIRED INSTANTLY, with the reason hardcoded to 'other' and nothing written.
  // Six reasons and two thousand characters of detail have been in the API the
  // whole time and nothing sent either, so every report arrived saying "other"
  // about nothing in particular. It opens the sheet now.
  const handleReportPost = (postId: string) => {
    setReportingPost(postId);
  };

  const handleBlockUser = (userId: string) => {
    Alert.alert('Block this person?', 'You will not see each other. They are not told.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: () => {
          safetyApi
            .block(userId)
            .then(() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Blocked');
              void loadFeed();
            })
            .catch(() => Alert.alert("Couldn't block them", 'Please try again.'));
        },
      },
    ]);
  };

  const handleMuteUser = (userId: string) => {
    safetyApi
      .mute(userId)
      .then(() => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Muted', 'Their posts will not appear in your feed.');
        void loadFeed();
      })
      .catch(() => Alert.alert("Couldn't mute them", 'Please try again.'));
  };

  const handleMessages = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/messages');
  };

  const handleNotifications = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/notifications');
  };

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0C1D18', '#17362A', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-2xl font-bold text-white">My Voice</Text>
          <View className="flex-row items-center">
            {/* Global Pulse */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowGlobalPulse(true);
              }}
              className="flex-row items-center bg-amber-500/20 px-3 py-2 rounded-full mr-2"
            >
              <TrendingUp size={16} color="#F59E0B" />
              <Text className="text-amber-500 text-xs font-medium ml-1">Pulse</Text>
            </Pressable>

            {/* Notifications */}
            <Pressable
              onPress={handleNotifications}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center mr-2 relative"
            >
              <Bell size={20} color="#8FA79A" />
              {notificationUnreadCount > 0 && (
                <View className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 items-center justify-center">
                  <Text className="text-slate-900 text-xs font-bold">
                    {notificationUnreadCount > 9 ? '9+' : notificationUnreadCount}
                  </Text>
                </View>
              )}
            </Pressable>

            {/* Messages */}
            <Pressable
              onPress={handleMessages}
              className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center mr-2 relative"
            >
              <Mail size={20} color="#8FA79A" />
              {unreadMessages > 0 && (
                <View className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 items-center justify-center">
                  <Text className="text-slate-900 text-xs font-bold">
                    {unreadMessages}
                  </Text>
                </View>
              )}
            </Pressable>

            {/* Create post */}
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowCreatePost(true);
              }}
              className="w-10 h-10 rounded-full bg-amber-500 items-center justify-center"
            >
              <Plus size={22} color="#0C1D18" />
            </Pressable>
          </View>
        </View>

        {/* Feed */}
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 20 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F59E0B"
              colors={['#F59E0B']}
            />
          }
          renderItem={({ item, index }) => (
            <PostCard
              post={item}
              index={index}
              onComment={handleComment}
              onShare={handleShare}
              onMore={handleMore}
            />
          )}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-20">
              <View className="w-20 h-20 rounded-full bg-slate-800 items-center justify-center mb-4">
                <MessageCircle size={36} color="#6E8A7C" />
              </View>
              <Text className="text-white font-semibold text-lg">
                No posts yet
              </Text>
              <Text className="text-slate-400 text-sm mt-1 text-center px-8">
                Be the first to share something with the community
              </Text>
              <Pressable
                onPress={() => setShowCreatePost(true)}
                className="mt-4 px-6 py-3 bg-amber-500 rounded-full"
              >
                <Text className="text-slate-900 font-semibold">
                  Create Post
                </Text>
              </Pressable>
            </View>
          }
        />
      </SafeAreaView>

      {/* Modals */}
      <CreatePostModal
        visible={showCreatePost}
        onClose={() => setShowCreatePost(false)}
      />

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

      <ReportSheet
        target={reportingPost ? { postId: reportingPost, what: 'this post' } : null}
        onClose={() => setReportingPost(null)}
        onFiled={() =>
          Alert.alert(
            'Report filed',
            'A jury of citizens is drawn to hear it, and you will be told what they decide.',
          )
        }
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
      <GlobalPulseDrawer
        visible={showGlobalPulse}
        onClose={() => setShowGlobalPulse(false)}
      />
    </View>
  );
}
