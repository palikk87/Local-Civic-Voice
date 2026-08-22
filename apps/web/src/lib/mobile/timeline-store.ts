import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { currentIdentity, fallbackAvatarFor } from './signed-in-identity';
// Web port: zustand persist uses localStorage instead of AsyncStorage
import type { User, Bill } from './types';
import { api } from '@/lib/api';
import { fetchServerFeed, type ServerPost } from './server-feed';
import { useUserProfilesStore } from './user-profiles-store';
import { useGlobalEngagementStore, type ReferenceType } from './global-engagement-store';

// Timeline Post Types
export type PostType = 'original' | 'share' | 'comment';
export type ContentType = 'text' | 'bill' | 'executive_order' | 'scotus_case';
export type PostSource = 'user' | 'library' | 'official';

/**
 * Sharing a document from the Library. The brief is written on the server from the
 * document's ENTIRE official text and already stored on the reference, so a share
 * carries only the reference id and that stored brief — never client-written text.
 */
export interface LibrarySharePayload {
  /** GovernmentReference.id returned by POST /api/government-references/resolve. */
  referenceId: string;
  brief: { summary: string; argumentFor: string; argumentAgainst: string };
}

/**
 * Static discussion prompt appended to a shared brief. Deliberately not AI-written:
 * the only generated text in a post is the grounded brief itself.
 */
const SHARE_DISCUSSION_PROMPT =
  'Does this match what you want your representatives doing on your behalf?';

// Vote counts for interactive posts
export interface PostVoteCounts {
  support: number;
  oppose: number;
  userVote?: 'support' | 'oppose';
}

// Representation Gap Poll for civic engagement
export interface RepresentationGapPoll {
  question: string;
  options: { id: string; text: string; votes: number }[];
  totalVotes: number;
  userVoteId?: string;
}

// Media attachment for posts
export interface PostMedia {
  type: 'youtube' | 'image' | 'iframe';
  url: string;
  thumbnailUrl?: string;
  title?: string;
}

export interface TimelinePost {
  id: string;
  author: User;
  type: PostType;
  content: string;
  contentType: ContentType;

  // Source tracking for Library-to-Feed parity (defaults to 'user')
  source?: PostSource;

  // AI-generated brief (3 sentences)
  aiBrief?: string;

  // Representation Gap interactive element
  representationGap?: RepresentationGapPoll;

  // Support/Oppose voting (distinct from likes)
  voteCounts?: PostVoteCounts;

  // Media attachments (YouTube, images, etc.)
  media?: PostMedia[];

  // For shares - the original content being shared
  sharedContent?: {
    type: ContentType;
    id: string;
    title?: string;
    /** The reference id as printed, e.g. "H.R. 4836" — set on server-backed posts. */
    displayId?: string;
    /** Where the action stands, e.g. "In Committee" — set on server-backed posts. */
    status?: string;
    /**
     * The law under this post has changed since it was written.
     *
     * Computed on the server so web and mobile cannot disagree about what
     * "since" means. The post is never edited — this is the card admitting that
     * the text being argued about is not the text that was argued about.
     */
    lawUpdatedSincePosting?: boolean;
    data?: Bill | Record<string, unknown>;
    originalAuthor?: User;
    originalPostId?: string;
    sourceUrl?: string;
    category?: string;
  };

  // User's opinion when sharing
  opinion?: string;

  // Engagement
  likes: number;
  comments: TimelineComment[];
  shares: number;
  isLiked: boolean;
  /** How many people have passed this on. */
  repostsCount?: number;
  /** Whether the person reading has already passed it on. */
  isRepostedByMe?: boolean;
  /** The post this one passes on, when it is a repost. */
  repostOf?: {
    id: string;
    content: string;
    author: { id: string; displayName: string; username: string; avatar: string };
    createdAt: string;
  } | null;

  // Timestamps
  createdAt: string;
  updatedAt: string;
}

export interface TimelineComment {
  id: string;
  author: User;
  content: string;
  taggedUsers: TaggedUser[];
  likes: number;
  isLiked: boolean;
  createdAt: string;
  replies?: TimelineComment[];
  parentCommentId?: string;
}

export interface TaggedUser {
  userId: string;
  username: string;
  displayName: string;
  startIndex: number;
  endIndex: number;
}

// Private Messaging Types
export interface Conversation {
  id: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  sender: User;
  content: string;
  // For sharing posts to DMs
  sharedPost?: TimelinePost;
  isRead: boolean;
  createdAt: string;
}

// Generate mock timeline posts

// Generate mock conversations

// Generate mock messages for a conversation

interface TimelineState {
  // Posts — served by the backend, not stored locally
  posts: TimelinePost[];
  isLoading: boolean;
  feedError: string | null;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Record<string, Message[]>;

  // Actions - Posts
  /** Load the newest page of the real feed from the backend. */
  loadFeed: () => Promise<void>;
  /**
   * Publish a post to the backend, then refresh the feed.
   *
   * `referenceId` must be a GovernmentReference id from the reference picker —
   * the server rejects anything that is not a real reference, which is what keeps
   * every post attached to one canonical government action.
   */
  createPost: (
    content: string,
    contentType?: ContentType,
    referenceType?: 'bill' | 'executive_order' | 'scotus_case',
    referenceId?: string,
    referenceTitle?: string,
    mediaIds?: string[]
  ) => Promise<void>;
  deletePost: (postId: string) => Promise<void>;
  editPost: (postId: string, content: string) => void;
  sharePost: (postId: string, opinion?: string) => void;
  shareContent: (contentType: ContentType, contentId: string, title: string, opinion?: string, mediaIds?: string[]) => Promise<void>;
  likePost: (postId: string) => void;

  // Actions - Comments
  addComment: (postId: string, content: string, taggedUsers?: TaggedUser[]) => void;
  likeComment: (postId: string, commentId: string) => void;
  replyToComment: (postId: string, parentCommentId: string, content: string, taggedUsers?: TaggedUser[]) => void;

  // Actions - Messages
  startConversation: (user: User) => string;
  sendMessage: (conversationId: string, content: string, sharedPost?: TimelinePost) => void;
  markAsRead: (conversationId: string) => void;
  loadMessages: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  shareToMessage: (userId: string, post: TimelinePost) => void;

  // Utility
  refreshFeed: () => void;
  searchUsers: (query: string) => User[];

  // Library Gateway
  createLibraryPost: (share: LibrarySharePayload) => Promise<void>;

  // Civic Engagement Actions
  voteOnPost: (postId: string, vote: 'support' | 'oppose') => void;
  /** Current tally shown on posts carrying this reference (for optimistic revert). */
  snapshotReferenceTally: (
    referenceId: string
  ) => { support: number; oppose: number; userVote?: 'support' | 'oppose' } | null;
  /** Move the tally locally before the server answers. */
  applyOptimisticReferenceVote: (referenceId: string, vote: 'support' | 'oppose') => void;
  /** Stamp the server's authoritative tally onto every post carrying the reference. */
  applyReferenceTally: (
    referenceId: string,
    votes: { support: number; oppose: number },
    userVote: 'support' | 'oppose' | null
  ) => void;
  /** Put a snapshot back after a failed vote. */
  restoreReferenceTally: (
    referenceId: string,
    tally: { support: number; oppose: number; userVote?: 'support' | 'oppose' }
  ) => void;
  voteOnRepresentationGap: (postId: string, optionId: string) => void;
  followAuthor: (userId: string) => void;
  unfollowAuthor: (userId: string) => void;
}

export const useTimelineStore = create<TimelineState>()(
  persist(
    (set, get) => ({
      posts: [],
      isLoading: false,
      feedError: null,
      // Empty. This used to call generateMockConversations() at store
      // creation, so every page load manufactured a set of direct-message
      // threads with invented people in them. Messages.tsx reads the real
      // /api/conversations endpoint and has its own empty state.
      conversations: [],
      activeConversationId: null,
      messages: {},

      loadFeed: async () => {
        set({ isLoading: true, feedError: null });
        try {
          // The personal timeline holds ONLY the user's own posts and shares.
          set({ posts: await fetchServerFeed(30, 'me'), isLoading: false });
        } catch (error) {
          // Leave whatever is on screen in place and surface the failure, rather than
          // showing an empty feed that looks like "nobody has posted".
          set({
            isLoading: false,
            feedError: error instanceof Error ? error.message : 'Could not load the feed',
          });
        }
      },

      createPost: async (content, _contentType = 'text', _referenceType, referenceId, _referenceTitle, mediaIds) => {
        if (!referenceId) {
          throw new Error('Pick a bill, order, or case before posting');
        }

        // The server derives type and title from the reference itself, so only the
        // id is sent. It rejects ids that do not match a real reference.
        await api.post<{ post: ServerPost }>('/api/posts', {
          content,
          governmentReferenceId: referenceId,
          ...(mediaIds && mediaIds.length > 0 ? { mediaIds } : {}),
        });

        await get().loadFeed();
      },

      /**
       * Delete a post — on the server first, then locally.
       *
       * This used to filter the local array and stop there. The post vanished
       * from the timeline, the user believed it was gone, and it was still
       * public: still returned by /api/posts and /api/feed, still listed in the
       * admin console, and back on screen after a reload. A delete that only
       * removes the evidence of itself is worse than one that fails loudly.
       *
       * Async and throwing on purpose. The caller awaits it and reports the
       * failure, because "your post was not deleted" is something the person
       * who asked for it has to be told.
       */
      deletePost: async (postId) => {
        await api.delete(`/api/posts/${postId}`);
        set((state) => ({
          posts: state.posts.filter((p) => p.id !== postId),
        }));
      },

      editPost: (postId, content) => {
        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId
              ? { ...p, content, updatedAt: new Date().toISOString() }
              : p
          ),
        }));
      },

      sharePost: (postId, opinion) => {
        const { posts } = get();
        const originalPost = posts.find((p) => p.id === postId);
        if (!originalPost) return;

        const newPost: TimelinePost = {
          id: `post-${Date.now()}`,
          author: currentIdentity(),
          type: 'share',
          content: originalPost.content,
          contentType: originalPost.contentType,
          sharedContent: {
            type: originalPost.contentType,
            id: originalPost.sharedContent?.id ?? originalPost.id,
            title: originalPost.sharedContent?.title ?? originalPost.content.slice(0, 100),
            data: originalPost.sharedContent?.data,
            originalAuthor: originalPost.author,
            originalPostId: originalPost.id,
          },
          opinion,
          likes: 0,
          comments: [],
          shares: 0,
          isLiked: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Update original post share count
        set((state) => ({
          posts: [
            newPost,
            ...state.posts.map((p) =>
              p.id === postId ? { ...p, shares: p.shares + 1 } : p
            ),
          ],
        }));
      },

      shareContent: async (_contentType, contentId, _title, opinion, mediaIds) => {
        // Sharing a reference is the same server operation as posting about it: the
        // user's opinion is the body and the reference is the canonical link.
        await api.post<{ post: ServerPost }>('/api/posts', {
          content: opinion ?? '',
          governmentReferenceId: contentId,
          ...(mediaIds && mediaIds.length > 0 ? { mediaIds } : {}),
        });

        await get().loadFeed();
      },

      likePost: (postId) => {
        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  isLiked: !p.isLiked,
                  likes: p.isLiked ? p.likes - 1 : p.likes + 1,
                }
              : p
          ),
        }));
      },

      addComment: (postId, content, taggedUsers = []) => {
        const { posts } = get();
        const post = posts.find((p) => p.id === postId);

        // Increment comment count for post author
        if (post) {
          const profilesStore = useUserProfilesStore.getState();
          profilesStore.incrementComment(post.author.id);
        }

        const newComment: TimelineComment = {
          id: `comment-${Date.now()}`,
          author: currentIdentity(),
          content,
          taggedUsers,
          likes: 0,
          isLiked: false,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: [...p.comments, newComment],
                  updatedAt: new Date().toISOString(),
                }
              : p
          ),
        }));
      },

      likeComment: (postId, commentId) => {
        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: p.comments.map((c) =>
                    c.id === commentId
                      ? {
                          ...c,
                          isLiked: !c.isLiked,
                          likes: c.isLiked ? c.likes - 1 : c.likes + 1,
                        }
                      : c
                  ),
                }
              : p
          ),
        }));
      },

      replyToComment: (postId, parentCommentId, content, taggedUsers = []) => {
        const newReply: TimelineComment = {
          id: `reply-${Date.now()}`,
          author: currentIdentity(),
          content,
          taggedUsers,
          likes: 0,
          isLiked: false,
          createdAt: new Date().toISOString(),
          parentCommentId,
        };

        set((state) => ({
          posts: state.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  comments: p.comments.map((c) =>
                    c.id === parentCommentId
                      ? {
                          ...c,
                          replies: [...(c.replies ?? []), newReply],
                        }
                      : c
                  ),
                }
              : p
          ),
        }));
      },

      startConversation: (user) => {
        const { conversations } = get();

        // Check if conversation already exists
        const existing = conversations.find((c) =>
          c.participants.some((p) => p.id === user.id)
        );

        if (existing) {
          set({ activeConversationId: existing.id });
          return existing.id;
        }

        // Create new conversation
        const newConversation: Conversation = {
          id: `conv-${Date.now()}`,
          participants: [currentIdentity(), user],
          unreadCount: 0,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: newConversation.id,
        }));

        return newConversation.id;
      },

      sendMessage: (conversationId, content, sharedPost) => {
        const newMessage: Message = {
          id: `msg-${Date.now()}`,
          conversationId,
          sender: currentIdentity(),
          content,
          sharedPost,
          isRead: false,
          createdAt: new Date().toISOString(),
        };

        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: [...(state.messages[conversationId] ?? []), newMessage],
          },
          conversations: state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessage: newMessage,
                  updatedAt: new Date().toISOString(),
                }
              : c
          ),
        }));
      },

      markAsRead: (conversationId) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c
          ),
          messages: {
            ...state.messages,
            [conversationId]: (state.messages[conversationId] ?? []).map((m) => ({
              ...m,
              isRead: true,
            })),
          },
        }));
      },

      loadMessages: (conversationId) => {
        const { messages } = get();

        // If messages already loaded, skip
        if (messages[conversationId]?.length) return;

        // Nothing to load here. This used to manufacture a thread of invented
        // messages between invented people. Real direct messages come from
        // /api/conversations/:id/messages, which Conversation.tsx reads.
        set((state) => ({
          messages: { ...state.messages, [conversationId]: [] },
        }));
      },

      setActiveConversation: (conversationId) => {
        set({ activeConversationId: conversationId });
        if (conversationId) {
          get().loadMessages(conversationId);
          get().markAsRead(conversationId);
        }
      },

      shareToMessage: (userId, post) => {
        // The target used to be looked up in sampleUsers, so sharing to anyone
        // real silently did nothing. ShareModal now passes an account from
        // /api/users/discover; carry the id through rather than resolving it
        // against a fixed cast.
        const conversationId = get().startConversation({
          id: userId,
          username: 'user',
          displayName: 'User',
          avatar: fallbackAvatarFor(userId),
        } as User);
        get().sendMessage(conversationId, 'Check out this post!', post);
      },

      refreshFeed: () => {
        void get().loadFeed();
      },

      searchUsers: (query) => {
        // Mention autocomplete used to search the mock cast, so typing "@" in a
        // comment offered people who do not exist. Real search is
        // /api/users/search; until a caller wires it in, offer nobody rather
        // than offering fiction.
        if (!query.trim()) return [];
        return [];
      },

      createLibraryPost: async (share) => {
        // The reference already exists — POST /api/government-references/resolve
        // created it and the server wrote the brief onto it from the full official
        // text. Sharing publishes a post pointing at that record.
        // The neutral paragraph is what a post carries. The two arguments stay
        // on the law's own card: a post is somebody choosing to say something,
        // and leading it with a pre-written case for and against would put
        // words in their mouth.
        const body = share.brief.summary.trim();

        await api.post<{ post: ServerPost }>('/api/posts', {
          content: `${body}\n\n${SHARE_DISCUSSION_PROMPT}`,
          governmentReferenceId: share.referenceId,
        });

        // Local gamification counter (unchanged behaviour)
        const profilesStore = useUserProfilesStore.getState();
        profilesStore.incrementLibraryPosts(currentIdentity().id);

        await get().loadFeed();
      },

      // Civic Engagement: Vote Support/Oppose on a post
      voteOnPost: (postId, vote) => {
        const { posts } = get();
        const post = posts.find((p) => p.id === postId);
        if (!post) return;

        const authorId = post.author.id;
        const currentVote = post.voteCounts?.userVote;
        const profilesStore = useUserProfilesStore.getState();

        // Update author profile stats
        if (vote === 'support') {
          if (currentVote === 'support') {
            // Removing support vote
            profilesStore.decrementSupportVote(authorId);
          } else if (currentVote === 'oppose') {
            // Switching from oppose to support
            profilesStore.decrementOpposeVote(authorId);
            profilesStore.incrementSupportVote(authorId);
          } else {
            // New support vote
            profilesStore.incrementSupportVote(authorId);
          }
        } else if (vote === 'oppose') {
          if (currentVote === 'oppose') {
            // Removing oppose vote
            profilesStore.decrementOpposeVote(authorId);
          } else if (currentVote === 'support') {
            // Switching from support to oppose
            profilesStore.decrementSupportVote(authorId);
            profilesStore.incrementOpposeVote(authorId);
          } else {
            // New oppose vote
            profilesStore.incrementOpposeVote(authorId);
          }
        }

        set((state) => ({
          posts: state.posts.map((p) => {
            if (p.id !== postId) return p;

            const voteCounts = p.voteCounts ?? { support: 0, oppose: 0 };

            // Toggle vote off if same vote
            if (currentVote === vote) {
              return {
                ...p,
                voteCounts: {
                  support: vote === 'support' ? voteCounts.support - 1 : voteCounts.support,
                  oppose: vote === 'oppose' ? voteCounts.oppose - 1 : voteCounts.oppose,
                  userVote: undefined,
                },
                updatedAt: new Date().toISOString(),
              };
            }

            // Change vote or new vote
            return {
              ...p,
              voteCounts: {
                support:
                  vote === 'support'
                    ? voteCounts.support + 1
                    : currentVote === 'support'
                    ? voteCounts.support - 1
                    : voteCounts.support,
                oppose:
                  vote === 'oppose'
                    ? voteCounts.oppose + 1
                    : currentVote === 'oppose'
                    ? voteCounts.oppose - 1
                    : voteCounts.oppose,
                userVote: vote,
              },
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },


      /*
       * Reference tally helpers — the store-level half of the ONE vote
       * pipeline (reference-votes.ts). All posts carrying the same law always
       * show the same numbers; the pipeline moves them optimistically, then
       * stamps the server's authoritative weighted tally, or restores the
       * snapshot when the server rejects the vote.
       */
      snapshotReferenceTally: (referenceId) => {
        const post = get().posts.find((p) => p.sharedContent?.id === referenceId);
        if (!post?.voteCounts) return null;
        return {
          support: post.voteCounts.support,
          oppose: post.voteCounts.oppose,
          ...(post.voteCounts.userVote ? { userVote: post.voteCounts.userVote } : {}),
        };
      },

      applyOptimisticReferenceVote: (referenceId, vote) => {
        set((state) => ({
          posts: state.posts.map((p) => {
            if (p.sharedContent?.id !== referenceId || !p.voteCounts) return p;
            const previous = p.voteCounts.userVote;
            let { support, oppose } = p.voteCounts;
            if (previous === 'support') support = Math.max(0, support - 1);
            if (previous === 'oppose') oppose = Math.max(0, oppose - 1);
            // Same vote again toggles off (mirrors the server's semantics).
            const next = previous === vote ? undefined : vote;
            if (next === 'support') support += 1;
            if (next === 'oppose') oppose += 1;
            return {
              ...p,
              voteCounts: { support, oppose, ...(next ? { userVote: next } : {}) },
            };
          }),
        }));
      },

      applyReferenceTally: (referenceId, votes, userVote) => {
        set((state) => ({
          posts: state.posts.map((p) =>
            p.sharedContent?.id === referenceId
              ? {
                  ...p,
                  voteCounts: {
                    support: votes.support,
                    oppose: votes.oppose,
                    ...(userVote ? { userVote } : {}),
                  },
                }
              : p
          ),
        }));
      },

      restoreReferenceTally: (referenceId, tally) => {
        set((state) => ({
          posts: state.posts.map((p) =>
            p.sharedContent?.id === referenceId
              ? {
                  ...p,
                  voteCounts: {
                    support: tally.support,
                    oppose: tally.oppose,
                    ...(tally.userVote ? { userVote: tally.userVote } : {}),
                  },
                }
              : p
          ),
        }));
      },

      // Civic Engagement: Vote on Representation Gap poll
      voteOnRepresentationGap: (postId, optionId) => {
        const { posts } = get();
        const post = posts.find((p) => p.id === postId);
        if (!post || !post.representationGap) return;

        const authorId = post.author.id;
        const previousVote = post.representationGap.userVoteId;
        const profilesStore = useUserProfilesStore.getState();

        // Only increment if this is a new vote (not changing existing vote)
        if (!previousVote) {
          profilesStore.incrementRepGapVote(authorId);
        }

        set((state) => ({
          posts: state.posts.map((p) => {
            if (p.id !== postId || !p.representationGap) return p;

            const gap = p.representationGap;

            // Already voted for this option - no change
            if (previousVote === optionId) return p;

            return {
              ...p,
              representationGap: {
                ...gap,
                options: gap.options.map((opt) => ({
                  ...opt,
                  votes:
                    opt.id === optionId
                      ? opt.votes + 1
                      : opt.id === previousVote
                      ? opt.votes - 1
                      : opt.votes,
                })),
                totalVotes: previousVote ? gap.totalVotes : gap.totalVotes + 1,
                userVoteId: optionId,
              },
              updatedAt: new Date().toISOString(),
            };
          }),
        }));
      },

      // Social: Follow an author
      followAuthor: (userId) => {
        set((state) => ({
          posts: state.posts.map((post) => {
            if (post.author.id !== userId) return post;
            return {
              ...post,
              author: {
                ...post.author,
                isFollowing: true,
                followers: post.author.followers + 1,
              },
            };
          }),
        }));
      },

      // Social: Unfollow an author
      unfollowAuthor: (userId) => {
        set((state) => ({
          posts: state.posts.map((post) => {
            if (post.author.id !== userId) return post;
            return {
              ...post,
              author: {
                ...post.author,
                isFollowing: false,
                followers: Math.max(0, post.author.followers - 1),
              },
            };
          }),
        }));
      },
    }),
    {
      name: 'timeline-store',
      storage: createJSONStorage(() => localStorage),
      // Posts are deliberately NOT persisted — the backend is their source of truth.
      // Persisting them would also resurrect the old locally-stored demo posts.
      partialize: (state) => ({
        conversations: state.conversations,
        messages: state.messages,
      }),
    }
  )
);

// Selectors
export const selectPosts = (state: TimelineState) => state.posts;
export const selectConversations = (state: TimelineState) => state.conversations;
export const selectActiveConversation = (state: TimelineState) => {
  if (!state.activeConversationId) return null;
  return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
};
export const selectUnreadCount = (state: TimelineState) =>
  state.conversations.reduce((acc, c) => acc + c.unreadCount, 0);
