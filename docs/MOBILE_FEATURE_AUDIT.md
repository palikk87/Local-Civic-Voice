# AYE & NAY Mobile App - Complete Feature Audit

**Audit Date:** July 2026  
**Purpose:** Comprehensive inventory of all mobile app features for web app porting

## OVERVIEW

The AYE & NAY mobile app (React Native/Expo) is a comprehensive civic engagement platform covering all 3 branches of government. It includes:
- Feed systems with advanced algorithms
- Voting and delegation (liquid democracy)
- Government data discovery
- User profiles and social features
- Admin and B2B analytics dashboards
- Founding documents (Constitution, Bill of Rights, Article V)

**Total Pages:** 45 screens/routes  
**Total Library Functions:** 30+ utility/data modules  
**Total Components:** 15+ reusable components

---

## CORE PAGES (TAB-BASED NAVIGATION)

All core features are in `/webapp/mobile/src/app/(tabs)/` with 5 main tabs:

### 1. HOME / FEED (`index.tsx` - 1151 lines)

**Purpose:** Main legislative feed with multi-branch government data

**What It Shows:**
- Adaptive feed based on 5 feed types:
  - **For You** - Personalized AI-ranked bills with discovery randomization
  - **Following** - Bills from followed users
  - **Trending** - Top-ranked bills by community engagement
  - **Gaps** - Bills with high representation gaps (public vs Congress vote)
  - **Local** - Bills by geographic location
- Daily Bill Digest (carousel of featured bills)
- Government branch filter tabs (All, Congress, Executive, Supreme Court)
- Civic Score header showing gamification progress
- Trust verification badges on bills

**Components Used:**
- `CivicScoreHeader` - Shows civic score, streak count, unread notifications
- `FeedTypeTabs` - Feed type selector
- `BranchFilterTabs` - 3-branch government filter
- `FeedReasonBadge` - Shows why item appears in feed
- `BranchBadge` - Indicates legislative/executive/judicial
- `TrustBadge` - Trust verification status
- `VoteButtons` - Yea/Nay voting with percentages
- `FeedCard` - Main feed item with user vote and actions

**API Calls:**
- `useFeed(20)` - Fetch Supabase feed items
- `useTrendingBills(5)` - Get trending items
- `useCastVote()` - Vote on bills (mutates)
- `useUserVote()` - Get current user vote
- `useUserFeedLikes()` - Get user's liked feed items
- `useToggleFeedLike()` - Like/unlike feed items (mutates)
- `useRandomizedBillFeed()` - Session-based bill randomization

**Key Features:**
- Session-based exclusion (seen bills not shown again in "For You")
- Weighted randomization using Fisher-Yates shuffle
- Representation Gap calculation (public vs official votes)
- Community vote percentages and projected outcomes
- Pull-to-refresh feed clearing
- Haptic feedback on actions

**MISSING IN WEB:** All of the above

---

### 2. TIMELINE / SOCIAL (`timeline.tsx` - 1155 lines)

**Purpose:** Social feed where users post about bills, share opinions, create conversations

**What It Shows:**
- User-generated posts about government actions
- Post types: vote updates, comments, shares
- Post content: bills, executive orders, Supreme Court cases, text
- Comments/replies on posts
- Post engagement (likes, reposts, comments)
- Global Pulse drawer (aggregate sentiment metrics)
- Post creation modal

**Key Features:**
- Post creation with bill/EO/case references
- Mention parsing (@username mentions)
- Comment threads
- Like/repost actions
- Reference type tracking (ReferenceType)
- Unread count management

**MISSING IN WEB:** All of the above (major feature)

---

### 3. DISCOVER / BROWSE (`discover.tsx` - 1024 lines)

**Purpose:** Explore and filter government actions across branches

**What It Shows:**
- **Trending Tab** - Popular bills with vote cards
- **Executive Tab** - Executive orders with president info
- **Judicial Tab** - Supreme Court cases with justice votes
- **Government Map Tab** - All government structure and personnel

**Sub-Features:**
- Congressional Leadership (Speaker, Majority/Minority Leaders)
- Cabinet Members with photos
- Supreme Court Justices (all 9 with ideology: conservative/liberal/moderate)
- Presidential Succession line
- Government Departments

**Key Features:**
- Category-based bill browsing
- Search functionality (integrated with `searchGovernment`)
- Real government data with fallback to mock
- Justice ideology filtering/display
- Cabinet member role information

**MISSING IN WEB:** All tabs except possibly trending

---

### 4. LIBRARY / SEARCH (`library.tsx` - 867 lines)

**Purpose:** Search and save government documents

**What It Shows:**
- Search bar with 3 government branch tabs
- Search results for: bills, executive orders, Supreme Court cases
- Result cards with title, status, category, sponsor
- Quick action buttons (view, share, save)
- Convert items to timeline posts

**Key Features:**
- Real-time search as you type
- Branch filtering (legislative/executive/judicial)
- Convert to timeline posts
- External links (Congress.gov, Federal Register, etc.)

**MISSING IN WEB:** Search and conversion to posts

---

### 5. PEOPLE / USERS (`people.tsx` - 532 lines)

**Purpose:** Discover and follow other users

**What It Shows:**
- User search functionality
- Suggested users to follow
- Active citizens (users with most votes)
- New members (newest joined)
- User cards with engagement stats

**Key Features:**
- Search users by name/username
- Follow/unfollow users
- User profile navigation
- Curated user lists

**MISSING IN WEB:** User discovery, search, follow system

---

### 6. PROFILE (`profile.tsx` - 729 lines)

**Purpose:** User's personal profile and settings

**What It Shows:**
- User avatar with vote count badge
- Name, username, bio, location, join date
- Follower/following counts
- Vote statistics (Yea/Nay/Total)
- Vote history (last 10 votes with bill cards)
- Achievements/badges earned
- Founding Documents quick links
- Liquid Democracy section (active delegations)
- Admin Console link
- B2B Analytics Portal link

**Key Features:**
- Sign out button
- Settings button placeholder
- Vote history with bill links
- Achievement tracking

**MISSING IN WEB:** Complete profile page, achievement system, vote history

---

## DETAIL PAGES (DYNAMIC ROUTES)

### 1. BILL DETAIL (`bill/[id].tsx` - 971 lines)

**What It Shows:**
- Bill metadata, status, chamber
- Full bill text and simplified text
- Citizens Brief (AI-generated summary)
- Real world impact
- Community voting with percentages
- Official congressional votes
- Representation Gap display
- Comments/discussions section

**MISSING IN WEB:** Complete bill detail with all features

---

### 2. EXECUTIVE ORDER DETAIL (`executive-order/[id].tsx` - 474 lines)

**What It Shows:**
- EO number, title, president, dates, status
- Full and simplified text
- Real world impact
- Related orders and revocation info
- Community voting

**MISSING IN WEB:** Executive order pages entirely

---

### 3. SUPREME COURT DETAIL (`scotus/[id].tsx` - 620 lines)

**What It Shows:**
- Case metadata (docket, term, dates, status, outcome)
- Vote breakdown (justice-by-justice)
- Case details (petitioner, respondent, question presented)
- Opinions and real world impact
- Community voting

**MISSING IN WEB:** Supreme Court case pages entirely

---

### 4. USER PROFILE (`user/[id].tsx` - 845 lines)

**What It Shows:**
- User info with civic engagement stats
- "Civil Leader Score" metrics
- Civil Leader badge/ranking
- Vote history
- Posts/activity timeline
- Follow/message buttons

**MISSING IN WEB:** User profiles with civic stats

---

### 5. DELEGATES / LIQUID DEMOCRACY (`delegates.tsx` - 419 lines)

**What It Shows:**
- Liquid Democracy explanation
- Featured delegates list
- Active delegations
- Create new delegation UI
- Bill of Rights Article I compliance notice

**Key Data:**
- `Delegation` - fromUserId, toUserId, category, createdAt, isActive
- `DelegateProfile` - username, expertise, delegatorCount, votingRecord
- `PolicyCategory` - healthcare, education, environment, etc., or "all"

**Key Features:**
- Category-specific delegations
- Delegation chaining detection
- Individual vote override (Article I compliance)
- Revocation at any time

**MISSING IN WEB:** Entire delegation system

---

### 6-11. FOUNDING DOCUMENTS & MESSAGING
- Constitution (`constitution.tsx`)
- Bill of Rights (`bill-of-rights.tsx`)
- Article V (`article-v.tsx` - 702 lines)
- Messages (`messages.tsx`)
- Notifications (`notifications.tsx`)
- Notification Settings (`notification-settings.tsx`)

**MISSING IN WEB:** All of these

---

## ADMIN FEATURES (`/app/admin/`)

Requires admin authentication. Includes 8 pages:

1. **Admin Dashboard** - Stats cards, menu items, system overview
2. **Admin Users** - User list, status management, account actions
3. **Admin Posts** - Content moderation, approve/reject posts
4. **Admin Analytics** - Charts, metrics, trends
5. **Admin Logs** - Activity logs, audit trail
6. **Admin Announcements** - System-wide broadcasts
7. **Admin Settings** - System configuration
8. **Admin Login** - Authentication

**MISSING IN WEB:** Admin dashboard entirely

---

## B2B FEATURES (`/app/b2b/`)

Business intelligence portal with 7 pages:

1. **B2B Dashboard** - Overview of metrics
2. **B2B Issues** - Track bills and issues
3. **B2B States** - Geographic analysis
4. **B2B Heatmap** - Regional/demographic visualization
5. **B2B Forecast** - Bill passage predictions
6. **B2B Reports** - Report generation and scheduling
7. **B2B Login** - Authentication

**MISSING IN WEB:** B2B portal entirely

---

## KEY LIBRARY MODULES

### 1. VOTING SYSTEM (`voting-store.ts`)
- `castVote(billId, vote)` - Record vote
- `toggleLike(feedItemId)` - Like/unlike
- Mock and Supabase integration

**MISSING IN WEB:** Like system on feed

---

### 2. DELEGATION SYSTEM (`delegation-store.ts`)
- Category-specific delegations
- Delegation chaining detection
- Individual vote override
- Featured delegates showcase

**MISSING IN WEB:** Entire system

---

### 3. GAMIFICATION & ENGAGEMENT
- Civic Score with levels
- Daily voting streak
- Category-specific bonuses
- Achievement system
- Session tracking

**MISSING IN WEB:** Gamification entirely

---

### 4. FEED ALGORITHM (`feed-algorithm.ts`)
- 5 feed types (For You, Trending, Gaps, Following, Local)
- Weighted scoring and ranking
- Session-based exclusion
- Representation gap detection
- Fisher-Yates shuffle for randomization
- Discovery score randomization

**MISSING IN WEB:** Feed algorithm (basic feed exists but not intelligent)

---

### 5. TIMELINE SYSTEM (`timeline-store.ts`)
- Post creation with government references
- Comment threading
- Mention parsing (@username)
- Like tracking

**MISSING IN WEB:** Timeline system entirely

---

### 6. NOTIFICATION SYSTEM (`notification-store.ts`)
- Notification types (follower, comment, mention, update, etc.)
- Read/unread tracking
- Reference linking

**MISSING IN WEB:** Notification system

---

### 7. AUTHENTICATION (`auth-store.ts`, `auth-context.tsx`)
- Mock auth (Zustand)
- Supabase auth integration
- Session persistence
- Profile data sync

**IN WEB:** Partially present

---

### 8. ADMIN SYSTEM (`admin-store.ts`)
- Admin authentication
- Dashboard statistics
- User/post management
- Session validation

**MISSING IN WEB:** Admin dashboard entirely

---

### 9. B2B SYSTEM (`b2b-store.ts`)
- Organization authentication
- Custom dashboards
- Report generation
- Metric tracking

**MISSING IN WEB:** B2B portal entirely

---

### 10. REPRESENTATION GAP (`representation-gap.ts`)
- Calculate public vs Congress vote discrepancy
- Gap percentage and direction
- Significant gap flagging (>30%)

**MISSING IN WEB:** Gap display on bills

---

### 11. TRUST VERIFICATION (`trust-verification.ts`)
- Source verification
- Data currency check
- Badge system (Verified, Updated, Needs Review, Unverified)

**MISSING IN WEB:** Trust badges on bills

---

### 12. GOVERNMENT DATA (`federal-government.ts`, `government-api.ts`)
- Supreme Court justices (9 with ideology)
- Cabinet members and departments
- Congressional leadership
- Presidential succession
- Search government data

**MISSING IN WEB:** Government map and most structure data

---

### 13. CONSTITUTION & BILL OF RIGHTS (`constitution.ts`, `bill-of-rights.ts`)
- Full Constitution text
- Amendment texts with explanations
- Article V self-correction process

**MISSING IN WEB:** Constitution and Bill of Rights pages

---

### 14. SUPABASE INTEGRATION (`supabase.ts`)
- Profiles, votes, feed, follows, bills, delegations, notifications

**IN WEB:** Partially present

---

### 15. AI SERVICES (`ai-service.ts`)
- Convert government action to post
- Bill summarization (Citizens Brief)
- Content recommendations

**MISSING IN WEB:** AI features

---

### 16. GLOBAL ENGAGEMENT (`global-engagement-store.ts`)
- Total community votes
- Most discussed bills
- Trending topics
- Civic Pulse metrics

**MISSING IN WEB:** Global engagement metrics

---

### 17. SEEN BILLS TRACKING (`seen-bills-store.ts`)
- Session-based filtering
- Exclude seen bills from "For You"
- Prevent repetition

**MISSING IN WEB:** Session exclusion logic

---

## COMPONENTS (15 total)

1. **CitizensBrief** - Bill summary display (MISSING)
2. **CommentSection** - Nested comments (MISSING)
3. **CreatePostModal** - Post creation (MISSING)
4. **DailyBillDigest** - Featured bills carousel (MISSING)
5. **GlobalPulseDrawer** - Aggregate metrics (MISSING)
6. **PulseGap** - Representation gap badge (MISSING)
7. **ShareModal** - Share content (PARTIAL)
8. **BillOfRightsBadge** - Badge indicator (MISSING)
9. **NewsReelCarousel** - News carousel (MISSING)
10. **PostOptionsModal** - Edit/delete posts (MISSING)
11. **ReferenceSearchModal** - Government search (MISSING)
12. **ResponsiveContainer** - Layout helper (LIKELY PORTED)
13. **Disclaimers** - Legal disclaimers (MISSING)
14. **ErrorBoundary** - Error handling (LIKELY PORTED)
15. **Themed** - Theme support (LIKELY PORTED)

---

## CRITICAL MISSING FEATURES - SUMMARY

**Entirely Missing (80% of app):**
1. Feed algorithm (gaps, ranking, diversity)
2. Timeline/social system (posts, comments, discussions)
3. Delegation system (liquid democracy)
4. Gamification (civic score, streaks, achievements)
5. Discover/browse tabs
6. Notifications system
7. Messaging system
8. Admin dashboard & features
9. B2B portal & analytics
10. Government personnel/structure map
11. Executive order pages
12. Supreme Court case pages
13. Constitution/Bill of Rights pages
14. User profiles with civic stats
15. All major components (Citizens Brief, Comments, Post creation, etc.)

**Partially Implemented:**
- Authentication (needs enhancement)
- Bill voting (basic exists)
- User profiles (basic exists)

---

## PORTING RECOMMENDATIONS

### Phase 1 (MVP - High Impact):
1. Feed algorithm with gap detection
2. Timeline system (posts, comments)
3. Discover tabs (trending, executive, judicial, gov map)
4. Basic delegation system

### Phase 2 (Core Features):
1. Gamification (civic score, streaks)
2. Notifications system
3. User profiles with civic stats
4. Constitution/Bill of Rights pages

### Phase 3 (Social):
1. Direct messaging
2. Comment threading
3. User search/follow
4. Achievements

### Phase 4 (Admin/B2B):
1. Admin dashboard (stats, moderation)
2. B2B portal (analytics, forecasting)
3. Advanced admin features

---

## KEY LIBRARY STATISTICS

- **Total library files:** 30+
- **Total page files:** 45+
- **Total components:** 15+
- **Lines of code (mobile):** ~17,600 in app/
- **Zustand stores:** 10+
- **React Query hooks:** 10+
- **API endpoints likely needed:** 40+

---

## CONCLUSION

The mobile app is a feature-rich civic engagement platform. Porting to web requires building **80%+ of these features from scratch**, as most are either entirely missing or only partially implemented. The web app currently has basic bill browsing and voting but lacks the sophisticated feed algorithm, social system, gamification, delegation, and analytics that make the mobile app compelling.

