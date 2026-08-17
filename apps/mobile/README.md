# Civic Voice

A high-trust civic engagement and voting ecosystem that enables citizens to engage with all 3 branches of government: **Legislative**, **Executive**, and **Judicial**. Cast simulated votes on bills, executive orders, and Supreme Court cases while tracking how your representatives vote. Built with React Native and powered by AI for intelligent analysis.

**Important:** Votes cast in this app are simulated and do not affect actual legislation or official government processes. However, all data is sourced from official government records.

## The Civil Voice Constitution

This platform operates under a **Constitution** - the supreme governing document that declares the Will of the People as the supreme authority. All code, algorithms, and leadership structures are subordinate to this document. The Constitution is accessible from the Profile screen.

### Article I: The Supremacy of the Pulse
- **The Pulse as Law**: The "Public Pulse" (aggregated, weighted sentiment of verified citizens) is the only official output
- **Anti-Manipulation**: No external entity can alter, suppress, or prioritize any segment of the Pulse
- **The Human Requirement**: Only verified humans may contribute; AI may summarize but has no vote or voice

### Article II: The Doctrine of Liquid Sovereignty
- **The Reclaimable Voice**: Political power is only "borrowed," never "won"
- **Instant Recall**: Every user can instantly revoke delegation from any Civil Leader
- **The Floor, Not the Ceiling**: Direct votes always override delegations without losing long-term delegation

### Article III: The Transparency of the Architecture
- **The Open Ledger**: Pulse calculation, Trust Scores, and Leader Magnification must be publicly auditable
- **Right to Audit**: Users may demand Integrity Audits if there's evidence of bot interference
- **Master Reference Integrity**: All data links to official Executive, Legislative, or Judicial source IDs

### Article IV: The Separation of Powers
- **The Electorate (Users)**: The sole source of all power - they vote, delegate, and impeach
- **The Vanguard (Civil Leaders)**: Earn magnification through merit; power is only what the Electorate lends
- **The Judiciary (Community Juries)**: High-trust users who resolve Code of Conduct disputes

### Article V: The Self-Correction Mechanism
- **Leader Accountability**: Leaders who misrepresent facts face immediate demotion by peer Jury
- **Platform Neutrality**: If administrators bias the Pulse, super-majority vote triggers System-Wide Reset

---

## The Civil Voice Bill of Rights

The Bill of Rights supplements the Constitution with individual protections - a covenant for the digital body politic that ensures user rights are protected in code, not just in policy.

### Article I: The Right of Individual Sovereignty (Liquid Democracy)
No user shall be permanently bound to any representative or leader. The power of the vote originates in the individual and is only lent, never given. Every citizen retains the absolute right to instantly revoke or reassign their delegation at any time, for any reason, without delay or penalty.

### Article II: The Right to Algorithmic Neutrality
The "Public Pulse" shall not be manipulated for profit, engagement, or bias. The platform shall remain a neutral conduit for human intent. No "Black Box" algorithm shall amplify one voice over another based on outrage or commercial interest; only the verifiable weight of Liquid Democracy shall determine the prominence of an idea.

### Article III: The Right of Redress & Transparency
The "Vote Details" of any federal action shall be a public record within the platform. Every user has the right to see the mathematical path of a decision—to know exactly how many direct votes and delegated weights formed the Pulse. No "Dark Money" or bot-driven influence shall be permitted to obscure the true will of the people.

### Article IV: The Right to Data Security & Anonymity
The right of the people to be secure in their digital persons, papers, and effects shall not be violated. Civic Voice shall collect only the minimum data necessary to verify citizenship and jurisdiction. Personal identity shall remain shielded from the federal government and third parties, ensuring that the "Public Pulse" is a reflection of honest conviction, not a target for surveillance.

### Article V: The Right to Meritocratic Leadership
The status of "Civil Leader" is a privilege granted by the community, not a right of the platform. A Leader's magnification is tied directly to their Trust Score. The community retains the right to "Impeach" or demote any leader who violates the platform's integrity or spreads verifiable falsehoods, as determined by the collective will of their followers.

---

## Founding Documents Integration

The Constitution and Bill of Rights are integrated throughout the app, not just as viewable documents:

### Visual Indicators
- **Rights Protected Badge**: Shown in home feed header, indicates platform operates under Bill of Rights
- **Article Badges**: Small badges (Art. I, Art. II, etc.) appear next to features they protect
- **Transparency Indicator**: Shows vote breakdown (direct vs delegated) per Article III
- **Delegation Right Indicator**: Shows instant revocation rights per Article I
- **Representation Gap Badge**: Shows the gap between Public Pulse and Official Government votes

### Where They Appear
- **Signup Screen**: Links to founding documents before account creation
- **Profile Screen**: "Founding Documents" section with Constitution, Bill of Rights, and Article V
- **Delegates Screen**: Article I indicator showing instant revocation rights + "Revoke All" button
- **Bill Detail Screen**: Article III transparency badge and vote breakdown
- **Home Feed Cards**: Representation Gap badges showing People vs Congress alignment
- **Article V Screen**: Impeachment UI and System Reset voting

### Article V: Self-Correction Mechanism
The Article V screen (`/article-v`) implements constitutional accountability:

**Impeachment of Civil Leaders:**
- View all Civil Leaders with their Trust Scores
- See falsehood counts and impeachment progress
- Vote to impeach leaders who misrepresent facts (50% of delegators required)
- Impeached leaders lose their magnification multiplier

**System-Wide Reset:**
- View active reset proposals with evidence
- Track voting progress toward 66% super-majority threshold
- Requires 50% participation to be valid
- Triggers platform neutrality review if passed

### Representation Gap
The cornerstone feature of Civic Voice - showing the separation between:
- **The People's Pulse**: How Civic Voice users voted on legislation
- **Official Government Vote**: How Congress actually voted

This gap is displayed on:
- Feed cards (compact badge showing gap percentage)
- Bill detail screens (full comparison with bars)
- Profile for tracking which bills had gaps

### Reusable Components (`src/components/BillOfRightsBadge.tsx`)
- `BillOfRightsBadge` - Compact or full badge showing rights protection
- `ArticleBadge` - Individual article indicator (I-V)
- `RightProtectionBanner` - Banner showing active right protection
- `DelegationRightIndicator` - Shows Article I revocation rights
- `TransparencyIndicator` - Shows Article III vote transparency
- `ConstitutionalPowerBadge` - Shows user's branch (Electorate/Vanguard/Judiciary)
- `FoundingDocumentsLink` - Quick access to both documents

### PulseGap Components (`src/components/PulseGap.tsx`)
- `PulseGap` - Full representation gap display with animated bars
- `PulseGapBadge` - Compact badge for feed cards

---

## All 3 Branches of Government

### Legislative Branch (Congress)
- Real bills from Congress.gov
- Track legislation through House and Senate
- See official vote tallies from representatives
- Data source: Congress.gov API

### Executive Branch (White House)
- Executive Orders from the Federal Register
- Track active, revoked, and superseded orders
- See which EOs impact you and your community
- Data source: Federal Register API

### Judicial Branch (Supreme Court)
- Supreme Court cases with real outcomes
- Justice voting breakdowns (6-3, 5-4, etc.)
- Landmark decisions like Dobbs, Bruen, Chevron
- Data source: CourtListener / Supreme Court Database

## Government Directory

The **Government** tab (`src/app/(tabs)/government.tsx`; web: `webapp/src/pages/Government.tsx`) is a
complete directory of the federal government, in four sections:

- **Congress** — all 537 members of the 119th Congress (435 Representatives + 5 delegates + 2 resident
  commissioners, and 100 Senators). Filter by chamber, party, or state; search by name, state, or
  leadership role. Each card shows party, chamber, district, leadership post, and tap-to-call /
  website / X contact actions.
- **Executive** — the President, the Vice President, all 15 Cabinet secretaries, cabinet-rank
  officials (USTR, SBA, EPA, OMB, DNI, CIA), and senior White House staff. Officials serving in an
  acting capacity are labelled **Acting**.
- **Judicial** — all nine Justices of the Supreme Court, Chief Justice first, then Associate Justices
  by seniority.
- **Leadership** — every member currently holding a congressional leadership post (Speaker of the
  House, President pro tempore, majority/minority leaders and whips), plus the full Presidential
  Line of Succession.

Tapping anyone opens a detail view with their facts and a constituent message form.

**Data sources (one water source, both faucets):**
- `GET /api/representatives` — live roster from the Congress.gov API, cached 24 h, with contact
  details, office, and leadership posts filled in by background enrichment. Falls back to a bundled
  snapshot (`backend/src/data/congress-fallback.ts`) if the API is unreachable.
- `GET /api/representatives/:id` — one member, enriched on demand.
- `GET /api/government/officials` — executive, judicial, departments, line of succession, and
  congressional leadership. Executive and judicial rosters live in
  `backend/src/data/federal-government.ts`; the Speaker and President pro tempore in the succession
  line are stitched in live from Congress.gov.

Shared contracts are Zod schemas in `backend/src/types.ts`; both apps consume them through
`src/lib/government-service.ts`.

## Core Features

### Authentication
- Sign up with email, username, password, and zip code
- Sign in to existing account
- Persistent login sessions via AsyncStorage
- Sign out from profile page
- **Admin Authentication**: Separate admin login for platform management

### Admin Console
A comprehensive administrative dashboard for managing the Civic Voice platform:

- **Dashboard Overview**
  - Total users, posts, votes, and comments statistics
  - Banned users and flagged posts counts
  - Active users today metrics
  - Quick access to all admin features

- **User Management**
  - Search and filter users by username, email, status
  - View detailed user profiles with engagement stats
  - Ban/unban users with reason and optional duration
  - Delete users (superadmin only)
  - Grant admin/moderator privileges to users

- **Content Moderation**
  - View all posts with filter by status (active, flagged, removed)
  - Flag posts for review with reason
  - Delete inappropriate content
  - View post details including engagement metrics

- **Analytics Dashboard**
  - Key metrics with trend indicators
  - Daily activity charts
  - Top categories breakdown
  - Today's summary stats
  - Moderation statistics

- **Announcements**
  - Create system-wide announcements
  - Choose announcement type (info, warning, alert)
  - View all active and expired announcements

- **Activity Logs**
  - Full audit trail of admin actions
  - Filter by action type (login, ban, delete, flag)
  - Timestamps and action details

- **System Settings**
  - Server status check
  - Database information
  - Cache management
  - Analytics reset (superadmin only)

**Admin Credentials:**
- Username: `PaliKK87`
- Password: `CivicAdmin2024!`
- Role: superadmin

### B2B Analytics Platform (Civic Intelligence)
A separate, enterprise-grade analytics platform for lobbyists, NGOs, corporations, campaigns, media organizations, and research institutions. This platform provides aggregated, anonymous public sentiment data without exposing individual user information.

**Access:** Navigate directly to `/b2b/login` (not visible to regular users)

**B2B Credentials:**
- API Key: `b2b_demo_key_2024`
- Tier: Enterprise (full access)

**Features:**

- **Dashboard Overview**
  - Platform-wide sentiment metrics by government branch
  - Engagement statistics (votes, posts, comments, active users)
  - Trending topics with velocity indicators
  - Quick access to all analytics modules

- **District Heatmap**
  - Interactive US map with all 435 congressional districts + DC
  - Color-coded sentiment visualization
  - Filter by issue category or party affiliation
  - State-level aggregation and drill-down
  - Geographic hotspot identification

- **Issue Tracker**
  - 15 policy categories (Healthcare, Economy, Immigration, etc.)
  - Support/Oppose sentiment breakdown
  - Related bills count and engagement metrics
  - Trend indicators (rising, falling, stable)
  - Geographic hotspots per issue

- **State Analysis**
  - State-by-state sentiment breakdown
  - District-level engagement metrics
  - Top issues per state
  - Representative party composition
  - Sortable by engagement, sentiment, or alphabetically

- **Forecasting** (Enterprise tier)
  - 30-day sentiment projections for bills and issues
  - Confidence intervals and prediction bounds
  - Impact factor analysis
  - Strategic recommendations

- **Reports**
  - Quick report templates (Executive Summary, Geographic, Issue Deep Dive)
  - Custom report builder with date range and filters
  - PDF and CSV export formats
  - Email delivery scheduling

**API Endpoints:**

| Endpoint | Description | Tier |
|----------|-------------|------|
| `/api/b2b/sentiment/overview` | Platform-wide sentiment | Basic |
| `/api/b2b/sentiment/issues` | Sentiment by issue | Basic |
| `/api/b2b/geo/districts` | All district data | Basic |
| `/api/b2b/geo/heatmap` | Heatmap visualization data | Basic |
| `/api/b2b/geo/states` | State-level aggregation | Basic |
| `/api/b2b/issues` | Issue tracker data | Basic |
| `/api/b2b/demographics/engagement` | Engagement patterns | Professional |
| `/api/b2b/issues/:id/timeline` | Issue sentiment timeline | Professional |
| `/api/b2b/forecast/bills/:id` | Bill sentiment forecast | Enterprise |
| `/api/b2b/forecast/issues/:id` | Issue momentum forecast | Enterprise |
| `/api/b2b/demographics/voting-patterns` | Voting analysis | Enterprise |

**Privacy Guarantee:**
All data is aggregated and anonymized. Individual user information is never shared or accessible through this platform.

### Home Feed
- **Smart Algorithm**: FB/Instagram/TikTok-style engagement-based feed ranking
  - Engagement scoring (likes, votes, shares weighted)
  - Recency decay with 6-hour half-life
  - Personalization based on voting history
  - Diversity penalty to prevent echo chambers
- **Comprehensive Mock Feed**: 20+ feed posts using existing users and all 3 branches of government
  - Legislative: Bills from mock-data.ts (Social Security, Tax Relief, TikTok Ban, KOSA, etc.)
  - Executive: Executive Orders from government-data.ts (Border Emergency, DEI, DOGE, J6 Pardons, etc.)
  - Judicial: Supreme Court cases (Trump Immunity, Chevron, Bump Stocks, etc.)
  - Features controversial bills showing representation gaps (Epstein List, Stock Trading Ban, Term Limits)
- **Daily Bill Digest**: Top bills sorted by Voice Weight score
  - Weight formula: W = (cosponsor_count × 1.5) + (amendment_count × 2.0) + (action_status_rank × 5.0)
  - Status ranks: Introduced (1), Committee Review (3), Passed House/Senate (5), Signed into Law (10)
  - Visual weight tiers: Critical, High Priority, Notable, Tracking
  - Auto-refreshes every 6 hours via pg_cron
- **Feed Types**: Switch between For You, Following, Trending, Gaps, and Local
- **Session Exclusion**: Prevents repetitive content via seenBillIds tracking
  - Fisher-Yates shuffle on top 20 results for varied orderings
  - Weighted randomization using discovery_score (Weight × Random Factor)
  - Session clears on pull-to-refresh for fresh content
- Social feed showing what bills your network is voting on
- See how your connections voted with their comments
- Like, reply, and share functionality
- Animated voting interactions with haptic feedback
- Pull-to-refresh support
- Optimized FlatList for smooth scrolling
- **Trust Badges**: Each bill shows verification status from official sources

### Social Media Feed Algorithm

A sophisticated recommendation algorithm that surfaces the most relevant and engaging content to users, promoting influential creators and trending content while maintaining feed diversity.

#### Algorithm Components

**1. Engagement Scoring**
- Likes: 1.0 weight
- Comments: 3.0 weight (deeper engagement)
- Shares: 5.0 weight (highest value - content amplification)
- Saves/Bookmarks: 4.0 weight (intent to return)
- Mentions: 2.0 weight

**2. Recency Score (Time Decay)**
- Exponential decay with 24-hour half-life
- New post boost: +20 points for posts < 3 hours old
- Prevents stale content from dominating feed

**3. Viral Detection**
- Monitors engagement velocity (engagement per hour)
- Posts with 5x normal engagement rate get 2x score multiplier
- Identifies breakout content within first hour

**4. Personalization**
- Following boost: +50 points for posts from followed users
- Category matching: +30 points for content in preferred categories
- Author affinity: +40 points for authors user frequently engages with
- Similar users: Collaborative filtering based on voting patterns

**5. Creator Influence Metrics**
- Follower count (logarithmic scale, capped at +30 to prevent domination)
- Average engagement rate
- Viral post count (posts with 10x average engagement)
- Influence score = followers × engagement × viral posts

**6. Diversity Controls**
- Same author penalty: 0.2x multiplier (prevents single user dominating)
- Same category penalty: 0.4x multiplier (ensures topic variety)
- Max 2 posts per author per feed page

**7. Restorative Feed Mechanics (Prevents Repetition)**

The algorithm ensures a healthy flow of new content rather than constantly showing the same top-engaged posts:

- **Engagement Saturation**: Posts with >500 engagement get diminishing returns (50% penalty on excess)
- **Fresh Content Ratio**: 30% of feed reserved for content < 6 hours old
- **Rising Content Detection**: 20% of feed for posts gaining momentum (high engagement rate)
- **Seen Content Penalty**: 90% penalty for posts shown 3+ times to same user
- **Gradual View Penalty**: 30% score reduction per previous view
- **Random Discovery Injection**: 15% chance to surface unexpected content to break filter bubbles
- **Interleaved Feed**: Fresh, rising, and regular content mixed in pattern (not sorted purely by score)

**8. Feed Mixing Strategy**

For "For You" and "Discover" feeds, posts are interleaved:
```
Slot 0: Regular  → Slot 1: Fresh   → Slot 2: Regular
Slot 3: Rising   → Slot 4: Regular → Slot 5: Fresh  → ...
```

This ensures users always see a mix of:
- Established high-quality content (regular)
- Brand new posts getting a chance (fresh)
- Posts gaining traction (rising)
- Random discoveries (injected)

#### Feed Types

| Feed Type | Description |
|-----------|-------------|
| `for_you` | Personalized algorithm-ranked feed with restorative mixing |
| `following` | Chronological posts from followed users (recency + score within 1hr) |
| `trending` | Sorted by pure engagement metrics |
| `discover` | Content from users you don't follow with discovery focus |

#### Interaction Tracking

The system tracks all user interactions to improve personalization:

- **View tracking**: Records when posts enter viewport
- **Dwell time**: Measures time spent viewing each post (min 500ms)
- **Batch processing**: Queues interactions, flushes every 5 seconds
- **Session memory**: Excludes viewed posts from "For You" feed
- **View history**: Tracks how many times each post was shown to apply repetition penalties

#### Backend API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/feed` | GET | Personalized feed with pagination |
| `/api/feed/discover` | GET | Discovery feed |
| `/api/feed/interaction` | POST | Track single interaction |
| `/api/feed/interactions/batch` | POST | Track multiple interactions |
| `/api/feed/similar-users` | GET | Users with similar voting patterns |
| `/api/feed/trending-hashtags` | GET | Trending hashtags |
| `/api/feed/trending-creators` | GET | Top content creators |
| `/api/feed/posts/:id/save` | POST | Save/bookmark a post |
| `/api/feed/posts/:id/share` | POST | Track post share |
| `/api/feed/saved` | GET | User's saved posts |

#### Database Models

- `UserInteraction`: Logs all user interactions with timestamps and metadata
- `CreatorMetrics`: Aggregated influence metrics per user (followers, engagement rate, viral posts)
- `PostMetrics`: Real-time engagement metrics per post (views, likes, shares, virality score)
- `UserFeedProfile`: User preferences and behavior patterns
- `PostSave`: Saved/bookmarked posts
- `PostShare`: Share tracking with type (internal, external, DM)
- `Mention`: User mentions in posts/comments
- `Hashtag`: Trending hashtag tracking

#### Article II Compliance

The algorithm operates under Article II of the Civil Voice Constitution:
- **No outrage amplification**: Algorithm does not boost inflammatory content
- **No paid promotion weights**: Commercial interests cannot influence ranking
- **Transparent weights**: All algorithm factors are documented and auditable
- **Human-first design**: Engagement quality over quantity

### Social Timeline
A personal timeline for users to create posts, share content, and engage with the community:

- **Create Posts**: Share your thoughts on civic matters with the community
  - Rich text posts with user mentions (@username)
  - Auto-complete user suggestions when typing @
  - Character limit with counter

- **Share with Opinion**: Share bills, executive orders, or SCOTUS cases
  - Add your personal opinion when sharing government content
  - Preview of shared content with quick navigation
  - Share to timeline or direct message

- **Library Post Parity**: Full-featured posts from the Library gateway
  - **Citizen's Brief**: server-written summary (from the complete official text) shown on timeline
  - **Support/Oppose Voting**: Vote on policy positions (separate from likes)
  - **Representation Gap Polls**: Interactive polls measuring public sentiment
  - **Content Type Indicators**: Visual badges for Bill, Executive Order, Court Case
  - **Source Attribution**: "From Library" indicator with official source links
  - **Follow Button**: Follow authors directly from their posts

- **Civil Leader Growth**: Engagement tracking for civic leadership
  - Library posts shared count toward Civil Leader score
  - Support/Oppose votes contribute to author stats
  - Representation Gap poll participation tracked
  - Comments received tracked per author
  - Civil Leader rankings: Observer → New Voice → Engaged Voter → Active Citizen → Policy Leader → Civic Champion

- **Comments & Tagging**: Full commenting system with user mentions
  - Tag other users with @username in comments
  - Nested replies to comments
  - Like individual comments
  - Real-time user suggestions when tagging

- **Private Messaging**: Direct message other users
  - Start conversations with any user
  - Share posts directly to messages
  - Unread message indicators
  - Message read receipts
  - Shared post previews in conversations

### Gamification System
- **Civic Score (0-1000)**: Level up from Newcomer to Democracy Leader
  - Voting Score: Points for each vote cast
  - Engagement Score: Points for reading bills and viewing gaps
  - Consistency Score: Bonus for maintaining streaks
  - Impact Score: Points for moral rewards
- **Badges**: 20+ achievements including:
  - First Voice, Active Voter, Century Voter
  - Gap Hunter, Truth Seeker, Local Champion
  - Weekly Warrior, Monthly Maven, Quarter Champion
  - Accountability Hero, Change Maker
- **Streaks**: Daily voting streaks with XP multipliers (up to 2x at 30 days)
- **Moral Rewards**: XP bonuses for exposing representation gaps

### Engagement & Notifications
- Push notifications for:
  - Gap alerts (>30% discrepancy)
  - Local bills affecting your state
  - Streak protection reminders
  - Badge unlocks
  - Trending bills
  - Representative vote updates
- Quiet hours and notification preferences
- Smart triggers with cooldown periods
- Session tracking for retention analytics

### Discover
- Browse trending bills with most community activity
- Filter by category (Healthcare, Education, Environment, etc.)
- Search bills by title or topic
- Find and follow like-minded citizens
- People suggestions carousel

### People (User Discovery)
Discover and connect with other civically engaged citizens:

- **Search Users**: Find users by username or display name
  - Real-time search with instant results
  - Tap any user to view their full profile

- **Suggested For You**: Personalized recommendations
  - Users you might want to follow based on your activity
  - Shows avatar, name, bio snippet, and follower count

- **Active Citizens**: Most engaged community members
  - Sorted by total votes and civic engagement
  - See who's making an impact in the community

- **New Members**: Recently joined users
  - Welcome newcomers to the platform
  - Sorted by join date

- **User Profile Screen**: Detailed view of any user
  - Profile header with avatar, name, username, bio
  - Stats: followers, following, votes
  - Follow/Unfollow button
  - Three tabs: Posts, Votes, About
  - Full engagement history and activity

### Library
A **live gateway** to official government records across all three branches, powered by the **Perpetual Semantic Librarian** AI system. Search real-time databases and convert documents into shareable posts:

#### Perpetual Semantic Librarian
The Library uses an intelligent search system that prioritizes relevance over recency:

- **AI-Powered Smart Search**: Understands everyday language and translates it into effective search terms
  - "gun laws" → searches for "firearms gun control second amendment weapons"
  - "weed laws" → searches for "cannabis marijuana legalization drug"
  - "stuff about immigration" → understands informal language
- **Dynamic Time-Scoping**: No fixed date filters - searches all Congressional sessions (107th-119th Congress)
- **Relevance over Recency**: Semantic matches prioritized regardless of age (e.g., PATRIOT Act from 2001 ranks high for "surveillance" queries)
- **Modern Vibe Detection**: For queries like "AI Privacy" or "TikTok Ban", applies recency boost while keeping historical foundations visible
- **Multi-Strategy Search**: Falls back through multiple search strategies to find results:
  1. Cache check (free, instant)
  2. AI-expanded keyword search
  3. Individual keyword searches
  4. Recent bills fallback
- **Status Labels**: Results labeled relative to present state:
  - `[Active]` - Currently enacted laws
  - `[Proposed]` - Bills under consideration
  - `[Repealed]` - Overturned or expired legislation
  - `[Landmark]` - Historic laws that became public law
  - `[Pending]` - Passed one chamber, awaiting final action

- **Live API Search**: Real-time queries to official government databases
  - Congress.gov API for legislation
  - Federal Register API for executive orders
  - CourtListener API for court cases

- **Congress Tab**: Search live Congressional bills
  - Semantic search by bill title, popular name, or topic
  - Status labels showing current state
  - View official source links

- **Executive Tab**: Search live executive orders
  - Relevance-ranked search from Federal Register
  - Filter active, revoked, superseded orders
  - Direct links to official documents

- **Judicial Tab**: Search live Supreme Court cases
  - Relevance-ranked search via CourtListener
  - See case status and outcomes
  - Direct links to official court records

- **Slide-Over Preview**: View document details before converting
  - Citizen's Brief pulled from the server (`POST /api/government-references/resolve` finds or
    creates the document's master reference, then the screen polls
    `GET /api/government-references/:id` until the brief is stored)
  - Waiting state while the server pulls the full official text; "unavailable" card when no
    official source publishes readable text — never an invented brief
  - Status label and metadata
  - Official source link

- **Convert to Post**: Share the server's brief to your feed
  - Posts the stored Citizen's Brief, attached to the same master reference (`governmentReferenceId`)
  - Creates Representation Gap prompt
  - Posts directly to your feed for community engagement
  - Links to Global Engagement for cross-platform vote aggregation

### Global Pulse
A real-time civic engagement dashboard showing trending government actions and civil leaders:

- **Global Engagement Aggregation**: Master-reference table linking all posts about the same law
  - Every post about HR-1049 shares the same engagement counts
  - Cross-platform vote totals (45K+ Support, 4K Oppose)
  - Real-time trending score calculation

- **Trending Laws**: Top 5 most-engaged government actions
  - Support/Oppose vote bars
  - Recent engagement indicators
  - Top contributors per law

- **Civil Leaders Leaderboard**: Users driving the most civic engagement
  - Total engagement driven (votes + comments their posts generated)
  - Post count and follower stats
  - Rank tiers: Observer → New Voice → Engaged Voter → Active Citizen → Policy Leader → Civic Champion

- **Bottom-Sheet UI**: Accessible from Timeline header "Pulse" button
  - Swipe-to-dismiss gesture
  - Pull-up from bottom sheet handle
  - Follow leaders directly from the drawer

### Bill Details
- **Plain English Summary**: Accessible explanation of what the bill does
- **Citizen's Brief**: server-written summary of the document's complete official text, cached on
  its master reference and shared by every reader:
  - The Goal: What the bill is trying to do
  - The Wallet: Fiscal impact and taxpayer cost/savings
  - The Debate: Arguments for and against
- **News Reels Carousel**: Media coverage from multiple sources with bias indicators
  - **Bias Color Coding**: Blue (Left), Gray (Center), Red (Right)
  - **Balanced Feed Algorithm**: 70% preferred content, 30% diverse perspectives
  - **Watch Time Tracking**: Records viewing history to personalize recommendations
  - **Ad Injection**: Civic Partner ads every 4th reel (hidden for Premium users)
  - **Sponsored Content**: Gold border indicates sponsored news reels
- **Full Text**: Complete legislative text from Congress.gov
- **Real-World Impact**: How the bill affects daily life
- **Related Laws**: Connected statutory law, case law, and regulations
- **Representation Gap Indicator**: Visual comparison of public vs Congressional votes
- AI-powered analysis with pros/cons breakdown
- "See Both Sides" debate points generator

### Supreme Court Case & Executive Order Details
Both detail screens open on a **Brief** tab with the same Citizen's Brief card used for bills
(shared `CitizensBriefCard` in `src/components/CitizensBrief.tsx`), followed by the existing tabs:

- **Supreme Court case** — Brief / Question / Opinions / Impact
  - Brief sections: The Question, The Ruling (or "What's At Stake" while the case is undecided), The Debate
  - Links out to the full opinion on CourtListener
- **Executive order** — Brief / Full Text / Impact
  - Brief sections: The Goal, The Wallet, The Debate (including the dispute over presidential authority)
  - Links out to the full text on the Federal Register

Briefs are written **only on the server**. `backend/src/services/reference-content.ts` pulls the
document's ENTIRE official text (Congress.gov / Federal Register / CourtListener, with a source
fallback chain), reads all of it, fact-checks the result, and stores the brief on the master
`GovernmentReference` row. Screens read it with `GET /api/government-references/:id` and poll while
`contentStatus` is `fetching` or `brief_pending`.

There is **no client-side brief writer** on either faucet — `src/lib/ai-service.ts` no longer has
`generateCitizensBrief` / `generateScotusBrief` / `generateExecutiveOrderBrief` / `convertToPost`,
and nothing falls back to summarising a title or a search blurb. If no source publishes readable
text, `contentStatus` becomes `unavailable` and the app says there's no brief instead of guessing.
First reader of a document waits a few seconds; everyone after is instant.

### News Reels & Bias Tracker
A media literacy feature that tracks news coverage across the political spectrum:

- **Media Bias Directory**: Pre-seeded database of news sources with bias ratings
  - Left: MSNBC, CNN, HuffPost, Vox, The Guardian
  - Center: AP, Reuters, BBC, WSJ, The Hill, NPR, PBS, C-SPAN
  - Right: Fox News, Newsmax, Breitbart, Daily Wire, NY Post
- **User Consumption Tracking**: Records which bias perspectives users consume
- **Balanced Feed Algorithm**: Ensures exposure to diverse viewpoints
  - 70% content matching user preference
  - 30% content from opposite perspective ("challenge content")
- **Bias History Store**: Persisted via AsyncStorage with Zustand
- **Premium Features**: Premium users see no ads or sponsored content

### Representation Gap Tracking
The core accountability feature showing discrepancies between public sentiment and official votes:

- **Pulse Gap Visualization**: Side-by-side comparison of Civic Voice community votes vs Congressional votes
- **Gap Detection**: Bills with > 30% discrepancy are highlighted as "Representation Gaps"
- **Statistical Verification**: Confidence levels based on sample size (95% confidence at 100+ votes)
- **Share the Gap**: Generate social media posts to raise awareness of voting discrepancies
- **State Breakdown**: See how votes differ by state/district

### Trust & Transparency Layer
- **Data Source Verification**: All bills verified against Congress.gov (100% trust score)
- **Trust Badges**: Visual indicators showing data reliability
- **Gap Verification**: Statistical significance calculations with margin of error
- **Representative Accountability**: Track alignment scores for elected officials
- **Shareable Reports**: Generate accountability posts for social media

### Liquid Democracy
A transformative voting model that allows users to delegate their votes to trusted experts:

- **Find Delegates**: Browse expert delegates by policy area
- **Category-Specific Delegation**: Delegate healthcare votes to a health policy expert, environment to a climate advocate, etc.
- **Global Delegation**: Assign one delegate for all topics
- **Revocable Authority**: Take back your delegation at any time
- **Delegation Tracking**: See your active delegations in your profile

### Representatives
- Contact your elected officials directly
- Call, email, or visit their website
- Send messages about legislation you care about
- Filter by House or Senate
- Party affiliation color coding

### Profile
- Track your voting history (persisted across sessions)
- Earn achievements for civic engagement
- See your vote breakdown (Yea vs Nay)
- Manage your Liquid Democracy delegations
- Follow/following stats
- Sign out button

## AI Integration

The app integrates with both Google Gemini and OpenAI GPT to provide:
- Intelligent bill analysis with balanced pros/cons
- Identification of impacted groups
- Debate-style arguments for both sides
- Question answering about specific bills

API keys are configured via environment variables:
- Model keys are backend-only (`GEMINI_API_KEY` / `OPENAI_API_KEY`). The app
  never holds one — anything `EXPO_PUBLIC_` is compiled into the shipped bundle.

## Legal Compliance

Per FEC requirements and democratic integrity standards:

- **Mock Voting Disclaimer**: Clear notice that this is an educational platform
- **AI Content Labels**: Summaries generated by AI are clearly marked
- **Bill Version Tracking**: Data source and last update timestamp displayed
- **Not Official Vote Warning**: Prominent notice on all voting interfaces
- **First-Time User Agreement**: Users acknowledge the educational nature before voting

## Tech Stack

- Expo SDK 53 with React Native 0.76.7
- NativeWind (TailwindCSS) for styling
- React Native Reanimated for animations
- Zustand for local state management
- React Query for server state
- **Hono + Prisma Backend** (SQLite database + Better Auth)
- Expo Router for navigation
- Expo Haptics for tactile feedback

## Backend Architecture

The app uses a **Hono** backend server with **Prisma** ORM and **SQLite** database:

### Database (Prisma + SQLite)
- `User` - User accounts with Better Auth integration
- `Session` - Authentication sessions
- `Account` - OAuth/credential accounts
- `Bill` - Legislative bills with metadata
- `Vote` - User votes on bills (support/oppose)
- `Post` - User posts and comments
- `PostLike` - Post likes
- `Comment` - Comments on posts
- `Follow` - User follow relationships
- `Delegation` - Liquid Democracy delegations

### API Routes
- `POST /api/auth/*` - Better Auth authentication (email OTP)
- `GET /api/bills` - List bills with pagination
- `GET /api/bills/:id` - Get single bill details
- `POST /api/bills/:id/vote` - Vote on a bill
- `DELETE /api/bills/:id/vote` - Remove vote
- `GET /api/posts` - Get posts feed
- `POST /api/posts` - Create a post
- `GET /api/users/discover` - Discover users
- `GET /api/users/search` - Search users
- `POST /api/users/:id/follow` - Follow a user

### Authentication (Better Auth)
- Email OTP authentication
- Secure cookie-based sessions
- Cross-platform support (mobile + web)

## Design

- Dark theme with navy blue (#0F172A) background
- Amber/gold (#F59E0B) accent color
- Green (#22C55E) for Yea votes
- Red (#EF4444) for Nay votes
- Clean card-based UI with subtle gradients
- Spring-based animations for smooth interactions
- Haptic feedback on votes and interactions

### Responsive Design

The app auto-adjusts for all screen sizes using a responsive utilities system:

**Core Hook: `useResponsive()` (`src/lib/useResponsive.ts`)**
- `width`, `height` - Current screen dimensions
- `breakpoint` - Current size category (xs, sm, md, lg, xl, xxl)
- `deviceType` - 'phone' | 'tablet' | 'desktop'
- `isPhone`, `isTablet` - Boolean device checks
- `fontScale`, `spacingScale` - Auto-calculated scaling factors
- `wp(percentage)` - Width percentage helper
- `hp(percentage)` - Height percentage helper
- `rs(size)` - Responsive spacing (scales padding/margins)
- `rf(size)` - Responsive font (scales text sizes)
- `select({ sm: value1, lg: value2, default })` - Breakpoint-based values
- `maxContentWidth` - Max width for content containers on tablets

**Breakpoints:**
| Name | Width | Devices |
|------|-------|---------|
| xs | 0-374 | iPhone SE, small phones |
| sm | 375-413 | iPhone 13 mini |
| md | 414-767 | iPhone Pro Max, large phones |
| lg | 768-1023 | iPad mini |
| xl | 1024-1365 | iPad Pro 11" |
| xxl | 1366+ | iPad Pro 12.9" |

**Responsive Components (`src/components/ResponsiveContainer.tsx`):**
- `ResponsiveContainer` - Wraps content with max-width constraints on tablets
- `ResponsiveRow` - Horizontal row that stacks vertically on phones
- `ResponsiveGrid` - Grid that adjusts columns based on screen size

**Usage Examples:**
```typescript
// In any component
const { wp, isTablet, rs, select } = useResponsive();

// Responsive widths
const cardWidth = isTablet ? wp(45) : wp(85);

// Responsive spacing
const padding = rs(16); // Scales with screen size

// Breakpoint-based values
const columns = select({ sm: 1, lg: 2, xl: 3, default: 1 });
```

## Project Structure

```
src/
├── app/                    # Expo Router screens
│   ├── _layout.tsx        # Root layout with auth
│   ├── signup.tsx         # Registration
│   ├── login.tsx          # Sign in
│   ├── delegates.tsx      # Liquid Democracy delegate finder
│   ├── messages.tsx       # Private messaging inbox
│   ├── conversation/[id].tsx # Individual conversation view
│   ├── (tabs)/            # Tab navigation
│   │   ├── index.tsx      # Home feed
│   │   ├── timeline.tsx   # Social timeline with posts
│   │   ├── library.tsx    # Searchable archive of all government actions
│   │   ├── discover.tsx   # Browse bills
│   │   ├── people.tsx     # Citizens and civic leaders
│   │   ├── government.tsx # Every federal official, all 3 branches
│   │   └── profile.tsx
│   └── bill/[id].tsx      # Bill detail
├── components/
│   ├── CreatePostModal.tsx # Create timeline posts with mentions
│   ├── CommentSection.tsx  # Comments with user tagging
│   ├── ShareModal.tsx      # Share content with opinions
│   ├── GlobalPulseDrawer.tsx # Trending laws and Civil Leaders drawer
│   ├── DailyBillDigest.tsx # Voice Weight sorted bill digest
│   ├── Disclaimers.tsx    # Legal compliance components
│   ├── NewsReelCarousel.tsx # News coverage with bias indicators
│   └── Themed.tsx         # Theme components
└── lib/                   # Utilities & state
    ├── auth-context.tsx   # Supabase Auth React Context
    ├── auth-store.ts      # Mock authentication state (fallback)
    ├── supabase.ts        # Supabase client configuration
    ├── database.types.ts  # TypeScript types for Supabase
    ├── hooks.ts           # React Query hooks for data fetching
    ├── voting-store.ts    # Voting state (persisted)
    ├── delegation-store.ts # Liquid Democracy delegations
    ├── timeline-store.ts  # Social timeline posts, comments, messages
    ├── bias-history-store.ts # User media consumption tracking
    ├── news-reels.ts      # News reel types and mock data
    ├── feed-algorithm.ts  # Smart feed ranking (FB/IG/TikTok style)
    ├── voice-weight.ts    # Voice Weight algorithm for bill impact scoring
    ├── seen-bills-store.ts # Session exclusion tracking for feed
    ├── gamification.ts    # Civic score, badges, streaks, moral rewards
    ├── engagement.ts      # Notifications, triggers, session tracking
    ├── trust-verification.ts # Data verification & accountability tools
    ├── ai-service.ts      # AI API integration (bill explanation, impact, debate points — NO brief writing)
    ├── library-resolve.ts # Library search result -> master reference resolve payload
    ├── use-library-brief.ts # Resolve + poll hook for the Library slide-over brief
    ├── government-api.ts  # Live API gateway (Congress.gov, Federal Register, CourtListener)
    ├── user-profiles-store.ts # Civil Leader stats tracking per author
    ├── global-engagement-store.ts # Global Pulse master-reference aggregation
    ├── mock-data.ts       # Sample bills/users
    ├── government-data.ts # All 3 branches: EOs, SCOTUS cases, legislation
    └── types.ts           # TypeScript types (Bill, ExecutiveOrder, SupremeCourtCase)
```

## Data Persistence

**With Supabase configured:**
- User authentication via Supabase Auth (JWT tokens)
- Voting history stored in PostgreSQL database
- Social feed and likes synced across devices
- Real-time updates for collaborative features

**Without Supabase (fallback mode):**
- User authentication persists via AsyncStorage
- Voting history persists via AsyncStorage
- Liked items persist via AsyncStorage
- Delegation preferences persist via AsyncStorage
- Media bias consumption history persists via AsyncStorage
- AI analysis responses cached for 30 minutes

## Performance Optimizations

- FlatList with virtualization for feed
- React Query caching for API responses
- **Optimistic updates** for voting (instant UI feedback with rollback on error)
- Optimized re-renders with Zustand selectors
- removeClippedSubviews enabled for lists
- Memoized render functions
- Pagination support for infinite scrolling

### Backend Scalability (1,000+ Users)

The backend is optimized to handle 1,000+ concurrent users with the following infrastructure:

**1. In-Memory LRU Caching**
- `feedCache` - 2 min TTL, 500 entries (feed responses)
- `userPrefsCache` - 5 min TTL, 1000 entries (user preferences)
- `metricsCache` - 10 min TTL, 500 entries (creator metrics)
- `trendingCache` - 5 min TTL, 50 entries (trending data)
- Cache hit rates monitored via `/health` endpoint

**2. Rate Limiting (Sliding Window)**
| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 100 req | 1 min |
| Feed | 30 req | 1 min |
| Interactions | 60 req | 1 min |
| Auth | 10 req | 1 min |

**3. Async Job Queue**
- Background processing for metric updates
- Priority levels (high/normal/low)
- Retry with exponential backoff
- Dead letter queue for failed jobs

**4. Query Optimizations**
- Batch loading (eliminates N+1 queries)
- Compound database indexes for common queries
- Reduced feed fetch from 150 to 60 posts
- Parallel query execution with Promise.all

**5. Database Indexes**
- `UserInteraction`: `[userId, interactionType, createdAt]`, `[postId, interactionType]`
- `PostMetrics`: `[viralityScore, createdAt]`, `[lastEngagementAt]`
- `CreatorMetrics`: `[influenceScore, totalFollowers]`
- `Vote`: `[userId, billId, position]`

**Health Monitoring**
```bash
curl https://your-backend/health
```
Returns cache stats, queue status, and rate limiter info.

### Cost Optimizations (AI & Database)

The app implements several strategies to minimize API costs and stay within Supabase Free Tier:

**AI Cost Reduction:**
- `gpt-4o-mini` model for bill identifier search (10x cheaper than gpt-4o)
- Condensed system prompts to minimize input tokens
- Strict JSON-only responses to minimize output tokens

**Cache-First Search Strategy:**
- `bill_cache` table stores search results for 7 days
- First search for a query costs money (AI + Congress.gov API)
- Subsequent identical searches are FREE (Supabase read only)
- Individual bills cached by ID for instant lookups

**Lightweight Timeline Posts:**
- `timeline_posts` table only stores: `user_id`, `bill_cache_id`, `opinion`
- Bill details fetched via SQL JOIN from `bill_cache`
- Keeps database small (~100 bytes per post vs ~5KB with full bill data)
- Enables staying within Supabase Free Tier (500MB) much longer

**Database Tables for Cost Optimization:**
| Table | Purpose | Row Size |
|-------|---------|----------|
| `bill_cache` | Cached bill data from API searches | ~3KB |
| `timeline_posts` | Lightweight post references | ~100 bytes |

**Cost Flow:**
1. User searches "climate change" → Cache miss → AI + API call ($0.01)
2. Results cached to `bill_cache` → Supabase write
3. Next user searches "climate change" → Cache HIT → $0.00
4. User shares bill to timeline → Only saves `bill_cache_id` → Minimal storage
5. Timeline loads → SQL JOIN pulls bill data from cache → Fast & free

## Architectural Principles

Based on high-assurance software architecture for civic technology:

1. **Data Veracity**: Legislative data sourced from official Congress.gov (real bills, real representatives)
2. **Institutional Trust**: Multi-layered security and bot mitigation
3. **Educational Empowerment**: AI-driven simplification of complex legal terminology
4. **Dynamic Representation**: Liquid Democracy with transitive delegation

## Multi-Session Congress Evolution

The app supports seamless transitions between Congressional sessions without data loss:

### Global Constants
- **system_settings table**: Stores `current_congress` (e.g., 119 for 2025-2027)
- All default queries filter by this value automatically
- Change one number to "evolve" the app to a new Congress

### Session-Linked Data
- `bills` table has `congress_number` column linking each bill to its Congress
- `votes` table preserves user voting history across sessions
- Historical data is never deleted when Congress changes

### History Tab Queries
- Current Congress: `WHERE congress_number = current_congress`
- Historical Bills: `WHERE congress_number < current_congress`
- Available hooks: `useCurrentCongressBills()`, `useHistoricalBills()`, `useAvailableCongresses()`

### Dynamic API Integration
- Congress.gov API calls use `getCurrentCongress()` for the endpoint URL
- Example: `/bill/{{current_congress}}/hr/1234`
- Cached for 1 hour to minimize database calls

### Transitioning to a New Congress
1. Update `system_settings` SET `value = '120'` WHERE `key = 'current_congress'`
2. App automatically queries Congress 120 for new bills
3. All Congress 119 data remains accessible in History tab
4. User votes preserved with their original `congress_number`

## Real Data Sources

**Important**: This app uses REAL government data. The only simulated aspect is that user votes don't affect actual outcomes.

### Legislative Branch - Congress
Data source: Congress.gov API

**Real Representatives (119th Congress)**
- Mike Johnson (Speaker of the House)
- John Thune (Senate Majority Leader)
- Alexandria Ocasio-Cortez
- Bernie Sanders
- Ted Cruz
- Nancy Pelosi
- Chuck Schumer
- Mitch McConnell

**Real Bills with Outcomes**
- H.R.5376 - Inflation Reduction Act (SIGNED: Largest climate investment, $35 insulin)
- H.R.3684 - Infrastructure Investment and Jobs Act (SIGNED: 135,000 bridges, 500k EV chargers)
- H.R.1319 - American Rescue Plan (SIGNED: $1,400 checks, child tax credit)
- S.2938 - Bipartisan Safer Communities Act (SIGNED: First gun law in 30 years)
- H.R.4346 - CHIPS Act (SIGNED: Domestic semiconductor manufacturing)
- H.R.8404 - Respect for Marriage Act (SIGNED: Same-sex marriage protection)
- H.R.3755 - Women's Health Protection Act (FAILED: 49-51 in Senate)
- H.R.1 - For the People Act (FAILED: Killed by filibuster)

**Controversial Bills with Large Voting Gaps**
Bills where public opinion significantly diverges from congressional votes:
- H.R.1049 - Epstein Client List Act (95% public support, 11% Congressional support)
- H.R.2847 - Ban Congressional Stock Trading (97% public support, Congress abstained)
- H.R.3391 - End Pharma Price Gouging (94% public support, 23% Congressional support)
- H.R.5892 - Term Limits for Congress (82% public support, 18% Congressional support)
- H.J.Res.29 - Overturn Citizens United (75% public support, 28% Congressional support)
- H.R.7812 - Audit the Fed (84% public support, 15% Congressional support)
- H.R.8234 - Protect Government Whistleblowers (91% public support, 31% Congressional support)
- H.J.Res.14 - Abolish Electoral College (61% public support, 34% Congressional support)

### Executive Branch - White House
Data source: Federal Register API

**Recent Executive Orders (Trump 2025)**
- EO 14147 - Border Emergency Declaration
- EO 14148 - Immigration Enforcement Order
- EO 14151 - End Federal DEI Programs
- EO 14156 - End Government Censorship
- EO 14160 - Ban Youth Gender Care
- EO 14165 - Unleashing American Energy
- EO 14175 - End Birthright Citizenship (blocked by courts)
- EO 14178 - DOGE Creation (Dept. of Government Efficiency)
- EO 14180 - J6 Pardons
- EO 14182 - Leave World Health Organization
- EO 14185 - End EV Mandates
- EO 14188 - Schedule F Revival (federal worker reclassification)

**Historical Executive Orders with Outcomes**
- EO 13769 - Travel Ban (REVOKED: Courts blocked, replaced, Supreme Court upheld v3)
- EO 14008 - Biden Climate Order (REVOKED: Paused drilling, now reversed by Trump)
- EO 13988 - LGBTQ Protections (REVOKED: Extended civil rights, now reversed)

### Judicial Branch - Supreme Court
Data source: CourtListener / Supreme Court Database

**Current Justices**
- John Roberts (Chief Justice, Bush 2005)
- Clarence Thomas (Bush 1991)
- Samuel Alito (Bush 2006)
- Sonia Sotomayor (Obama 2009)
- Elena Kagan (Obama 2010)
- Neil Gorsuch (Trump 2017)
- Brett Kavanaugh (Trump 2018)
- Amy Coney Barrett (Trump 2020)
- Ketanji Brown Jackson (Biden 2022)

**Landmark Cases with Outcomes**
- Trump v. United States (2024) - Presidential immunity established, 6-3
- Loper Bright v. Raimondo (2024) - Chevron deference overturned, 6-3
- Garland v. Cargill (2024) - Bump stocks legal, 6-3
- Dobbs v. Jackson (2022) - Roe v. Wade overturned, 6-3
- NY Rifle v. Bruen (2022) - Concealed carry expanded, 6-3
- SFFA v. Harvard (2023) - Affirmative action ended, 6-3
- Biden v. Nebraska (2023) - Student loan forgiveness blocked, 6-3

**Pending Cases**
- US v. Skrmetti - Transgender youth healthcare (argued Dec 2024)
- Free Speech Coalition v. Paxton - Age verification for websites (argued Nov 2024)
- Dept. of Education v. Louisiana - Title IX transgender protections (argued Jan 2025)
- Murphy v. NCAA - College athlete compensation (pending)
- Texas v. Planned Parenthood - Abortion provider Medicaid funding (pending)
- US v. Texas - SB4 immigration enforcement (argued Feb 2025)
- NRA v. Vullo - Government retaliation (decided 9-0)

## Future Enhancements

- Ranked-Choice Voting (RCV) support
- Real-time bill tracking with Congress.gov API
- Zero-Knowledge Proof identity verification
- Push notifications for bill updates
- Community discussion threads

---

## Deployment Guide

### Prerequisites

1. A [Supabase](https://supabase.com) account (free tier works)
2. A [Vercel](https://vercel.com) account for hosting
3. (Optional) OpenAI and/or Google Gemini API keys for AI features

### Step 1: Set Up Supabase

1. Create a new Supabase project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Once created, go to **SQL Editor** in the sidebar
3. Copy the contents of `supabase-schema.sql` from this repository
4. Paste and run the SQL to create all tables, triggers, and RLS policies
5. Go to **Settings > API** and copy:
   - **Project URL** (e.g., `https://abc123.supabase.co`)
   - **Anon/Public Key** (starts with `eyJ...`)

### Step 2: Configure Authentication

1. In Supabase dashboard, go to **Authentication > Providers**
2. Ensure **Email** provider is enabled
3. (Optional) Configure email templates under **Authentication > Email Templates**
4. (Optional) Enable additional providers (Google, Apple, etc.)

### Step 3: Environment Variables

Create a `.env` file based on `.env.template`:

```bash
# Required for Supabase
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here

# Optional - AI Features
```

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Your Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous/public API key |
| `EXPO_PUBLIC_CONGRESS_API_KEY` | Yes* | Congress.gov API key for legislation search (get free key at https://api.congress.gov/sign-up/) |

*Note: The Congress.gov API key is required for live legislation search. Without it, search results will be limited.

### Step 4: Deploy to Vercel

1. Push your code to GitHub
2. Import the repository in [Vercel](https://vercel.com/new)
3. Add the environment variables from Step 3 in Vercel's project settings
4. Deploy!

### Dual-Mode Operation

The app is designed to work **with or without** Supabase configured:

- **With Supabase**: Full functionality including real authentication, persistent votes across devices, and social features
- **Without Supabase**: Falls back to local mock data and AsyncStorage for development/demo purposes

This allows you to:
- Develop and test locally without a database
- Demo the app immediately without setup
- Gradually migrate to production with Supabase

### Backend API

The backend server (in `/backend`) provides API endpoints for:

#### Government API Proxy
- `GET /api/government/congress/search?q=query` - Search Congress.gov bills
- `GET /api/government/executive/search?q=query` - Search Federal Register
- `GET /api/government/judicial/search?q=query` - Search CourtListener cases

#### User Management
- `GET /api/users/search?q=query` - Search users by username/displayName
- `GET /api/users/discover` - Get suggested users to follow
- `GET /api/users/:id` - Get user profile
- `GET /api/users/:id/followers` - Get user's followers
- `GET /api/users/:id/following` - Get users they follow
- `POST /api/users/:id/follow` - Follow a user
- `DELETE /api/users/:id/follow` - Unfollow a user

#### Timeline/Social
- `GET /api/timeline` - Get feed posts
- `POST /api/timeline/posts` - Create a post
- `POST /api/timeline/posts/:id/like` - Like a post
- `POST /api/timeline/posts/:id/vote` - Support/Oppose vote
- `POST /api/timeline/posts/:id/comments` - Add comment

#### Messaging
- `GET /api/messages/conversations` - List conversations
- `POST /api/messages/conversations` - Start conversation
- `GET /api/messages/conversations/:id` - Get messages
- `POST /api/messages/conversations/:id` - Send message

### Error Handling

The app includes comprehensive error handling:

- **Error Boundaries**: React error boundaries catch JavaScript errors in components
  - Displays user-friendly error message
  - Shows "Try Again" button to recover
  - Error details shown in development mode
  - Located in `src/components/ErrorBoundary.tsx`

- **Network Error Resilience**: Graceful handling of network failures
  - Falls back to mock data when APIs unavailable
  - Retry logic for failed requests
  - Clear error messages for users

### Database Schema Overview

The Supabase schema includes:

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles linked to Supabase Auth |
| `bills` | Legislative bills with full metadata |
| `votes` | User votes on bills (Yea/Nay) |
| `comments` | Comments on bills and feed items |
| `feed_items` | Social feed activity |
| `feed_likes` | Likes on feed items |
| `follows` | User follow relationships |
| `representatives` | Elected officials data |
| `delegations` | Liquid Democracy vote delegations |
| `delegate_profiles` | Expert delegate information |
| `bill_cache` | Cached search results (cost optimization) |
| `timeline_posts` | Lightweight post references with bill_cache join |

All tables have **Row Level Security (RLS)** enabled:
- Users can only modify their own data
- Public data (bills, representatives) is readable by all
- Private data (votes, follows) respects user permissions

### Troubleshooting

**"Unable to resolve @supabase/supabase-js"**
```bash
bun add @supabase/supabase-js
```

**Auth not working**
- Verify environment variables are set correctly
- Check Supabase dashboard for auth errors
- Ensure RLS policies are applied (run the SQL schema)

**Votes not persisting**
- Confirm user is authenticated
- Check `votes` table RLS policies in Supabase
- View browser console for API errors
