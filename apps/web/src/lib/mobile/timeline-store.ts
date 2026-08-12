import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
// Web port: zustand persist uses localStorage instead of AsyncStorage
import type { User, Bill } from './types';
import { sampleUsers, currentUser, mockBills, representatives } from './mock-data';
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
  brief: { theGoal: string; theWallet: string; theDebate: string };
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
const generateMockPosts = (): TimelinePost[] => {
  const now = new Date();

  return [
    // CONTROVERSIAL POSTS WITH CRITICAL OPINIONS
    {
      id: 'post-epstein-1',
      author: sampleUsers[0],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-1049',
        title: 'Epstein Client List Transparency and Accountability Act',
      },
      opinion: '95% of Americans want the Epstein client list released. Only 47 members of Congress voted yes. 312 voted NO. Who are they protecting? This is why people don\'t trust institutions anymore.',
      likes: 4523,
      comments: [
        {
          id: 'comment-epstein-1',
          author: sampleUsers[1],
          content: 'The gap between public opinion (95% yes) and Congress (11% yes) is the most damning evidence of corruption. They\'re ALL implicated.',
          taggedUsers: [],
          likes: 1245,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
        },
        {
          id: 'comment-epstein-2',
          author: sampleUsers[3],
          content: 'Why did 76 members ABSTAIN? That\'s not a vote against - that\'s hiding. Name them.',
          taggedUsers: [],
          likes: 892,
          isLiked: false,
          createdAt: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
        },
      ],
      shares: 2341,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 1).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 1).toISOString(),
    },
    {
      id: 'post-stock-1',
      author: sampleUsers[1],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-2847',
        title: 'Ban Congressional Stock Trading',
      },
      opinion: '97% of Americans support banning congressional stock trading. 12 Congress members voted yes. The rest? They ABSTAINED. Not even the courage to vote no. Pelosi made $65M trading stocks. Cruz, Tuberville, all of them. Legal corruption.',
      likes: 5678,
      comments: [
        {
          id: 'comment-stock-1',
          author: sampleUsers[2],
          content: 'Nancy Pelosi\'s husband bought millions in NVIDIA before the CHIPS Act. Ted Cruz sold airlines before COVID lockdowns. This isn\'t coincidence - it\'s insider trading.',
          taggedUsers: [],
          likes: 2341,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 20).toISOString(),
        },
      ],
      shares: 3456,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
    },
    {
      id: 'post-pharma-1',
      author: sampleUsers[3],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-3391',
        title: 'End Pharma Price Gouging',
      },
      opinion: 'As a doctor, I watch patients die because they can\'t afford insulin that costs $5 to make and sells for $300. 94% support price caps. 89 Congress members voted yes. 301 voted NO. Pharma spent $350M lobbying last year. This is blood money.',
      likes: 3892,
      comments: [
        {
          id: 'comment-pharma-1',
          author: sampleUsers[4],
          content: 'My student\'s mom rationed insulin and died. The same insulin costs $30 in Canada. Congress doesn\'t work for us.',
          taggedUsers: [],
          likes: 1567,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 40).toISOString(),
        },
        {
          id: 'comment-pharma-2',
          author: sampleUsers[0],
          content: 'Follow the money: Every Congress member who voted NO received pharma donations. Every. Single. One.',
          taggedUsers: [],
          likes: 1234,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 25).toISOString(),
        },
      ],
      shares: 2789,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 3).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 3).toISOString(),
    },
    {
      id: 'post-termlimits-1',
      author: sampleUsers[2],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-5892',
        title: 'Term Limits for Congress',
      },
      opinion: '82% of Americans want term limits. 78 Congress members voted yes. 357 voted to keep their jobs forever. McConnell: 40 years. Pelosi: 37 years. Grassley: 49 years. They\'ll NEVER vote themselves out. The system is rigged.',
      likes: 4567,
      comments: [
        {
          id: 'comment-term-1',
          author: sampleUsers[1],
          content: 'The same people who voted NO have been in office longer than most Americans have been alive. That tells you everything.',
          taggedUsers: [],
          likes: 1890,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 35).toISOString(),
        },
      ],
      shares: 2345,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
    },
    {
      id: 'post-citizensunited-1',
      author: sampleUsers[4],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-6234',
        title: 'Overturn Citizens United',
      },
      opinion: '75% of Americans - LEFT AND RIGHT - want Citizens United overturned. 124 voted yes. 311 voted NO. Why? Because the billionaires who fund their campaigns don\'t want it. Dark money won. Democracy lost.',
      likes: 3456,
      comments: [
        {
          id: 'comment-cu-1',
          author: sampleUsers[0],
          content: 'In 2024, 100 billionaires spent more on elections than the bottom 100 million Americans combined. That\'s not democracy - that\'s oligarchy.',
          taggedUsers: [],
          likes: 2123,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 50).toISOString(),
        },
      ],
      shares: 1987,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
    },
    {
      id: 'post-fed-1',
      author: sampleUsers[1],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-7812',
        title: 'Audit the Fed',
      },
      opinion: 'The Fed gave $16 TRILLION to banks during 2008. We only know this because of a partial audit. 84% want a full audit. 67 voted yes. 368 voted NO. What are they hiding? Who got our money?',
      likes: 2890,
      comments: [
        {
          id: 'comment-fed-1',
          author: sampleUsers[2],
          content: 'They printed trillions for banks at 0% interest, then raised rates on US mortgages and credit cards. We subsidize Wall Street.',
          taggedUsers: [],
          likes: 1456,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 55).toISOString(),
        },
      ],
      shares: 1678,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString(),
    },
    {
      id: 'post-whistleblower-1',
      author: sampleUsers[0],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-8234',
        title: 'Protect Government Whistleblowers',
      },
      opinion: 'Snowden exposed mass surveillance. Assange exposed war crimes. Reality Winner exposed election interference. All prosecuted. 91% want whistleblower protections. 134 voted yes. 301 voted NO. The government wants to hide, not be accountable.',
      likes: 3234,
      comments: [
        {
          id: 'comment-whistle-1',
          author: sampleUsers[3],
          content: 'They call themselves transparent but prosecute anyone who proves otherwise. That tells you everything about who DC really works for.',
          taggedUsers: [],
          likes: 1345,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
        },
      ],
      shares: 1890,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 7).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 7).toISOString(),
    },
    {
      id: 'post-electoral-1',
      author: sampleUsers[3],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-4521',
        title: 'Abolish Electoral College',
      },
      opinion: 'Wyoming voters have 3.6x the power of California voters. 61% want the popular vote. 148 voted yes. 287 voted NO. Why? Because the system benefits whoever controls small states. Democracy should mean one person = one vote.',
      likes: 2678,
      comments: [
        {
          id: 'comment-ec-1',
          author: sampleUsers[4],
          content: '5 presidents lost the popular vote but won anyway. In what world is that democracy?',
          taggedUsers: [],
          likes: 1567,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 40).toISOString(),
        },
      ],
      shares: 1456,
      isLiked: false,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 8).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 8).toISOString(),
    },
    // ORIGINAL POSTS
    {
      id: 'post-1',
      author: sampleUsers[0],
      type: 'original',
      content: 'Just finished reading about the Social Security Fairness Act. Finally some recognition for public sector workers! What do you all think?',
      contentType: 'text',
      likes: 45,
      comments: [
        {
          id: 'comment-1',
          author: sampleUsers[1],
          content: '@democracy_now Totally agree! My mom is a retired teacher and this would make a huge difference for her.',
          taggedUsers: [{
            userId: 'user-1',
            username: 'democracy_now',
            displayName: 'Alex Rivera',
            startIndex: 0,
            endIndex: 13,
          }],
          likes: 12,
          isLiked: false,
          createdAt: new Date(now.getTime() - 1000 * 60 * 30).toISOString(),
        },
      ],
      shares: 8,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 10).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 10).toISOString(),
    },
    {
      id: 'post-2',
      author: sampleUsers[1],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 'hr-82',
        title: 'Social Security Fairness Act',
        originalAuthor: sampleUsers[0],
      },
      opinion: 'This is exactly what we need. Public workers have been penalized for too long. Let\'s make some noise about this! 🗳️',
      likes: 89,
      comments: [],
      shares: 23,
      isLiked: false,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
    },
    {
      id: 'post-3',
      author: sampleUsers[2],
      type: 'original',
      content: 'The climate provisions in the recent legislation are a step in the right direction, but we need to push for more. Who else is advocating for stronger environmental protections?',
      contentType: 'text',
      likes: 67,
      comments: [
        {
          id: 'comment-2',
          author: sampleUsers[3],
          content: '@green_future Count me in! As a physician, I see the health impacts of environmental degradation daily.',
          taggedUsers: [{
            userId: 'user-3',
            username: 'green_future',
            displayName: 'Sam Chen',
            startIndex: 0,
            endIndex: 12,
          }],
          likes: 8,
          isLiked: true,
          createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
        },
        {
          id: 'comment-3',
          author: sampleUsers[4],
          content: '@green_future @healthcare_hero We should organize! I can bring this to my students as a civic engagement project.',
          taggedUsers: [
            {
              userId: 'user-3',
              username: 'green_future',
              displayName: 'Sam Chen',
              startIndex: 0,
              endIndex: 12,
            },
            {
              userId: 'user-4',
              username: 'healthcare_hero',
              displayName: 'Dr. Maya Patel',
              startIndex: 14,
              endIndex: 29,
            },
          ],
          likes: 15,
          isLiked: false,
          createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 4.5).toISOString(),
        },
      ],
      shares: 12,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString(),
    },
    {
      id: 'post-4',
      author: sampleUsers[3],
      type: 'share',
      content: '',
      contentType: 'bill',
      sharedContent: {
        type: 'bill',
        id: 's-596',
        title: 'Treat and Reduce Obesity Act',
      },
      opinion: 'As a doctor, this bill could save thousands of lives. Medicare coverage for obesity treatment is long overdue. The evidence is clear - treating obesity prevents diabetes, heart disease, and more.',
      likes: 156,
      comments: [],
      shares: 45,
      isLiked: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 8).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 8).toISOString(),
    },
    {
      id: 'post-5',
      author: sampleUsers[4],
      type: 'original',
      content: 'Education funding is at a crossroads. We need to invest in our future - that means better teacher pay, updated materials, and modern facilities. Our kids deserve better.',
      contentType: 'text',
      likes: 234,
      comments: [],
      shares: 67,
      isLiked: false,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 12).toISOString(),
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 12).toISOString(),
    },
  ];
};

// Generate mock conversations
const generateMockConversations = (): Conversation[] => {
  const now = new Date();

  return [
    {
      id: 'conv-1',
      participants: [currentUser, sampleUsers[0]],
      lastMessage: {
        id: 'msg-1',
        conversationId: 'conv-1',
        sender: sampleUsers[0],
        content: 'Hey! Did you see the vote on the tax relief bill?',
        isRead: false,
        createdAt: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
      },
      unreadCount: 1,
      updatedAt: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    },
    {
      id: 'conv-2',
      participants: [currentUser, sampleUsers[1]],
      lastMessage: {
        id: 'msg-2',
        conversationId: 'conv-2',
        sender: currentUser,
        content: 'Thanks for the info on the KOSA bill!',
        isRead: true,
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
      },
      unreadCount: 0,
      updatedAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 24 * 7).toISOString(),
    },
  ];
};

// Generate mock messages for a conversation
const generateMockMessages = (conversationId: string): Message[] => {
  const now = new Date();

  if (conversationId === 'conv-1') {
    return [
      {
        id: 'msg-1-1',
        conversationId: 'conv-1',
        sender: currentUser,
        content: 'Hey Alex! Following up on that Social Security discussion.',
        isRead: true,
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
      },
      {
        id: 'msg-1-2',
        conversationId: 'conv-1',
        sender: sampleUsers[0],
        content: 'Absolutely! I think it has a real chance of passing this time.',
        isRead: true,
        createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 1.5).toISOString(),
      },
      {
        id: 'msg-1-3',
        conversationId: 'conv-1',
        sender: currentUser,
        content: 'The bipartisan support is encouraging.',
        isRead: true,
        createdAt: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
      },
      {
        id: 'msg-1',
        conversationId: 'conv-1',
        sender: sampleUsers[0],
        content: 'Hey! Did you see the vote on the tax relief bill?',
        isRead: false,
        createdAt: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
      },
    ];
  }

  return [
    {
      id: 'msg-2-1',
      conversationId: 'conv-2',
      sender: sampleUsers[1],
      content: 'Hi! I wanted to share some insights about the Kids Online Safety Act.',
      isRead: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 4).toISOString(),
    },
    {
      id: 'msg-2-2',
      conversationId: 'conv-2',
      sender: sampleUsers[1],
      content: 'There are some concerns about how it might affect LGBTQ+ content, but overall the intent is good.',
      isRead: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 3.5).toISOString(),
    },
    {
      id: 'msg-2',
      conversationId: 'conv-2',
      sender: currentUser,
      content: 'Thanks for the info on the KOSA bill!',
      isRead: true,
      createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
    },
  ];
};

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
  deletePost: (postId: string) => void;
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
      conversations: generateMockConversations(),
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

      deletePost: (postId) => {
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
          author: currentUser,
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
          author: currentUser,
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
          author: currentUser,
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
          participants: [currentUser, user],
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
          sender: currentUser,
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

        // Load mock messages
        const mockMessages = generateMockMessages(conversationId);

        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: mockMessages,
          },
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
        const targetUser = sampleUsers.find((u) => u.id === userId);
        if (!targetUser) return;

        const conversationId = get().startConversation(targetUser);
        get().sendMessage(conversationId, 'Check out this post!', post);
      },

      refreshFeed: () => {
        void get().loadFeed();
      },

      searchUsers: (query) => {
        if (!query.trim()) return [];
        const lowerQuery = query.toLowerCase().replace('@', '');
        return sampleUsers.filter(
          (u) =>
            u.username.toLowerCase().includes(lowerQuery) ||
            u.displayName.toLowerCase().includes(lowerQuery)
        );
      },

      createLibraryPost: async (share) => {
        // The reference already exists — POST /api/government-references/resolve
        // created it and the server wrote the brief onto it from the full official
        // text. Sharing publishes a post pointing at that record.
        const body = [share.brief.theGoal, share.brief.theWallet]
          .filter((part) => part?.trim())
          .join('\n\n');

        await api.post<{ post: ServerPost }>('/api/posts', {
          content: `${body}\n\n${SHARE_DISCUSSION_PROMPT}`,
          governmentReferenceId: share.referenceId,
        });

        // Local gamification counter (unchanged behaviour)
        const profilesStore = useUserProfilesStore.getState();
        profilesStore.incrementLibraryPosts(currentUser.id);

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
