# Feature Porting Checklist - Mobile to Web

## PAGES/SCREENS TO PORT (45 Total)

### Tab Navigation (5 Main Screens)
- [ ] Home Feed with algorithm (5 feed types: For You, Following, Trending, Gaps, Local)
- [ ] Timeline/Social (user-generated posts)
- [ ] Discover (4 tabs: Trending, Executive, Judicial, Government Map)
- [ ] Library/Search (search government documents)
- [ ] People/Users (discover & follow users)

### User Profile Screens
- [ ] User Profile (own profile with vote history & achievements)
- [ ] Other User Profiles (view user's civic stats and posts)

### Government Detail Screens
- [ ] Bill Detail Page (971 lines of features)
- [ ] Executive Order Detail (474 lines)
- [ ] Supreme Court Case Detail (620 lines)

### Governance Education
- [ ] Constitution Page
- [ ] Bill of Rights Page
- [ ] Article V / Impeachment Page (702 lines)

### Social/Engagement
- [ ] Delegates/Liquid Democracy (419 lines)
- [ ] Messages/DMs (conversation threading)
- [ ] Notifications (notification feed)
- [ ] Notification Settings (preferences)
- [ ] Comment/Conversation Thread Detail

### Admin Portal (8 Pages)
- [ ] Admin Login
- [ ] Admin Dashboard (433 lines)
- [ ] Manage Users (540 lines)
- [ ] Manage Posts/Moderation (422 lines)
- [ ] Analytics Dashboard
- [ ] System Logs
- [ ] Announcements Manager
- [ ] Admin Settings

### B2B Portal (7 Pages)
- [ ] B2B Login
- [ ] B2B Dashboard (433 lines)
- [ ] Issue Tracking (404 lines)
- [ ] State Analysis (geographic breakdown)
- [ ] Heatmap Visualization (490 lines)
- [ ] Bill Forecasting (425 lines)
- [ ] Report Generation (396 lines)

---

## CORE SYSTEMS TO BUILD

### Feed System
- [ ] Feed algorithm (ranking, diversity, randomization)
- [ ] 5 feed types (For You, Following, Trending, Gaps, Local)
- [ ] Representation Gap calculation
- [ ] Fisher-Yates shuffle implementation
- [ ] Session-based bill exclusion
- [ ] Community vote aggregation
- [ ] Trust verification system
- [ ] Feed reason badges

### Social Features
- [ ] Timeline/post creation
- [ ] Comments with threading
- [ ] Mention parsing (@username)
- [ ] Like/favorite system (on posts and feed items)
- [ ] Share buttons and modals
- [ ] User following system
- [ ] Post editing and deletion
- [ ] Report/flag content

### Voting System
- [ ] Cast vote on bills
- [ ] Vote persistence (Supabase)
- [ ] User vote history
- [ ] Community vote display
- [ ] Yea/Nay percentages
- [ ] Projected outcome calculation

### Delegation System (Liquid Democracy)
- [ ] Create delegation to expert
- [ ] Category-specific delegations
- [ ] Global "all categories" delegation
- [ ] Revoke delegation
- [ ] Delegation chaining detection
- [ ] Individual vote override enforcement
- [ ] Featured delegates showcase
- [ ] Delegation policy categories

### Gamification
- [ ] Civic Score calculation (0-1000+)
- [ ] 5 Civic Levels (Novice, Engaged, Advocate, Civic Hero, Champion)
- [ ] Daily voting streak tracking
- [ ] Category-specific XP bonuses
- [ ] Achievements/badges (4 base achievements)
- [ ] Level-up notifications
- [ ] Streak reset logic

### Notifications
- [ ] Notification types (8+ types)
- [ ] Read/unread tracking
- [ ] Reference linking (to bills, users, posts)
- [ ] Notification settings panel
- [ ] In-app notification badge
- [ ] Clear/delete notifications
- [ ] Unread count aggregation

### User System
- [ ] User profiles with bio, location, join date
- [ ] Follower/following counts
- [ ] Vote count tracking
- [ ] Civic engagement stats
  - Library posts count
  - Support/oppose votes received
  - Rep gap poll votes received
  - Comments received
  - Civil Leader Score calculation
- [ ] Civil Leader badge/ranking
- [ ] User search and discovery
- [ ] Suggested users to follow

### Government Data
- [ ] Bill search and filtering
- [ ] Executive order browsing
- [ ] Supreme Court case tracking
- [ ] Congressional leadership display
  - Speaker of House
  - Majority/Minority Leaders (House & Senate)
- [ ] Cabinet members with roles
- [ ] Supreme Court justices (all 9 with ideology)
- [ ] Presidential succession line
- [ ] Federal government departments
- [ ] Search government API integration

### Admin System
- [ ] Admin authentication & roles
- [ ] Dashboard statistics
  - Total users
  - Active users
  - Total posts
  - Total votes
  - Flagged content
  - Pending approvals
- [ ] User management (suspend, ban, roles)
- [ ] Post moderation (approve, reject, delete)
- [ ] Analytics (charts, metrics, trends)
- [ ] Audit logs
- [ ] System announcements
- [ ] Admin settings panel

### B2B System
- [ ] B2B authentication
- [ ] Dashboard metrics
- [ ] Issue/bill tracking
- [ ] State-level analysis
- [ ] Heatmap visualizations
  - Geographic heatmap
  - Demographic heatmap
- [ ] Bill passage forecasting
- [ ] Report generation & scheduling
- [ ] Export functionality

---

## COMPONENTS TO BUILD (15 Total)

- [ ] Citizens Brief (bill summary: Goal, Wallet, Debate)
- [ ] Comment Section (nested threading)
- [ ] Create Post Modal
- [ ] Daily Bill Digest (carousel)
- [ ] Global Pulse Drawer (aggregate metrics)
- [ ] Pulse Gap Badge (rep gap indicator)
- [ ] Share Modal
- [ ] Bill of Rights Badge
- [ ] News Reel Carousel
- [ ] Post Options Modal (edit/delete/report)
- [ ] Reference Search Modal
- [ ] Vote Buttons
- [ ] Feed Cards
- [ ] User Cards
- [ ] Achievement Badge

---

## DATA STRUCTURES TO IMPLEMENT

### Vote System
- [ ] Vote { billId, vote ('yea'|'nay'), votedAt }
- [ ] UserVote tracking per bill
- [ ] Vote history querying

### Delegation System
- [ ] Delegation { fromUserId, toUserId, category, createdAt, isActive }
- [ ] DelegateProfile { userId, username, expertise[], delegatorCount, votingRecord }
- [ ] PolicyCategory enum (10 categories + 'all')

### Civic Engagement
- [ ] CivicScore { total, level, xpToNextLevel }
- [ ] Streak { current, best, lastVoteDate, resetDate }
- [ ] CivicStats { libraryPostsCount, supportVotes, opposeVotes, repGapVotes, comments, civilLeaderScore }

### Feed System
- [ ] ScoredFeedItem { bill, user, score, feedReason }
- [ ] FeedReason { type, [additional fields by type] }
- [ ] RepresentationGap { billId, publicApprovalPct, officialApprovalPct, gapPercentage, direction }

### Timeline System
- [ ] TimelinePost { userId, username, content, contentType, contentId, timestamp, likes, comments }
- [ ] CommentThread { authorId, content, timestamp, likes, replies }

### Government Data
- [ ] Bill { id, title, sponsor, status, chamber, category, votes, text, ... }
- [ ] ExecutiveOrder { eoNumber, title, president, status, signedDate, ... }
- [ ] SupremeCourtCase { docketNumber, caseName, votes, outcome, ... }
- [ ] Justice { name, appointedBy, ideology, ... }
- [ ] OfficeHolder { name, title, chamber, party, state, photo, contact }
- [ ] GovernmentDepartment { name, secretary, mission, website }

### User System
- [ ] User { id, username, displayName, avatar, bio, location, joinedDate, followers, following, votes, civicStats }
- [ ] UserProfile { id, username, displayName, email, avatar, bio, location, joined_date, followers_count, following_count, votes_count }

### Notification
- [ ] Notification { id, userId, type, title, message, referenceId, referenceType, createdAt, isRead, actionUrl }

### Admin
- [ ] AdminSession { adminId, email, role ('superadmin'|'admin'), loginAt }
- [ ] AdminStats { totalUsers, activeUsers, totalPosts, totalVotes, flaggedContent, pendingApprovals }
- [ ] ModeratedPost { postId, postContent, status, flagCount, reportedBy[] }

### B2B
- [ ] BillForecast { billId, confidencePercentage, factors[], timeline, committeeSentiment }
- [ ] RegionalMetrics { state, engagementScore, trends, populationDemographics }
- [ ] CustomReport { id, title, metrics[], dateRange, format }

---

## API ENDPOINTS TO CREATE

### Authentication (3-4)
- POST /api/auth/signup
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/auth/refresh

### Bills & Government (15+)
- GET /api/bills (with filters)
- GET /api/bills/:id
- GET /api/bills/trending
- GET /api/bills/search
- GET /api/executive-orders
- GET /api/executive-orders/:id
- GET /api/scotus-cases
- GET /api/scotus-cases/:id
- GET /api/government/justices
- GET /api/government/cabinet
- GET /api/government/leadership
- GET /api/government/succession
- GET /api/government/departments
- GET /api/government/search

### Voting (5)
- POST /api/votes
- GET /api/votes/user/:userId
- GET /api/votes/bill/:billId
- GET /api/votes/history
- DELETE /api/votes/:voteId

### Feed (8)
- GET /api/feed
- GET /api/feed/trending
- GET /api/feed/gaps
- GET /api/feed/following
- GET /api/feed/local
- POST /api/feed/:itemId/like
- DELETE /api/feed/:itemId/like
- GET /api/feed/seen

### Timeline/Posts (10)
- POST /api/posts
- GET /api/posts
- GET /api/posts/:id
- PATCH /api/posts/:id
- DELETE /api/posts/:id
- POST /api/posts/:id/comments
- GET /api/posts/:id/comments
- DELETE /api/comments/:commentId
- POST /api/posts/:id/like
- DELETE /api/posts/:id/like

### Users & Social (12)
- GET /api/users
- GET /api/users/search
- GET /api/users/:id
- GET /api/users/:id/profile
- PATCH /api/users/:id/profile
- POST /api/users/:id/follow
- DELETE /api/users/:id/follow
- GET /api/users/:id/followers
- GET /api/users/:id/following
- GET /api/users/:id/votes
- GET /api/users/:id/posts
- GET /api/users/suggested

### Delegations (8)
- POST /api/delegations
- GET /api/delegations
- GET /api/delegations/:id
- DELETE /api/delegations/:id
- GET /api/delegates
- GET /api/delegates/featured
- POST /api/delegations/validate
- GET /api/delegations/chain/:category

### Notifications (8)
- GET /api/notifications
- POST /api/notifications/:id/read
- POST /api/notifications/read-all
- DELETE /api/notifications/:id
- DELETE /api/notifications
- PATCH /api/notifications/:id
- GET /api/notifications/unread-count
- PATCH /api/user/notification-settings

### Messaging (6)
- GET /api/messages
- GET /api/messages/:conversationId
- POST /api/messages
- DELETE /api/messages/:messageId
- POST /api/messages/mark-read
- GET /api/conversations

### Admin (25+)
- GET /api/admin/stats
- GET /api/admin/dashboard
- GET /api/admin/users
- PATCH /api/admin/users/:id
- POST /api/admin/users/:id/suspend
- POST /api/admin/users/:id/ban
- DELETE /api/admin/users/:id
- GET /api/admin/posts
- PATCH /api/admin/posts/:id (approve/reject)
- DELETE /api/admin/posts/:id
- POST /api/admin/posts/:id/review
- GET /api/admin/logs
- POST /api/admin/announcements
- GET /api/admin/announcements
- PATCH /api/admin/announcements/:id
- DELETE /api/admin/announcements/:id
- GET /api/admin/analytics
- GET /api/admin/settings
- PATCH /api/admin/settings
- GET /api/admin/reports
- POST /api/admin/reports
- GET /api/admin/audit-log
- POST /api/admin/logout
- GET /api/admin/verify-session

### B2B (20+)
- GET /api/b2b/dashboard
- GET /api/b2b/metrics
- GET /api/b2b/issues
- POST /api/b2b/issues
- GET /api/b2b/issues/:id
- DELETE /api/b2b/issues/:id
- GET /api/b2b/states
- GET /api/b2b/states/:stateCode
- GET /api/b2b/heatmap (geographic)
- GET /api/b2b/heatmap/demographic
- POST /api/b2b/forecast
- GET /api/b2b/forecast/:billId
- POST /api/b2b/reports
- GET /api/b2b/reports
- GET /api/b2b/reports/:id
- DELETE /api/b2b/reports/:id
- POST /api/b2b/reports/export
- GET /api/b2b/representatives/:state
- GET /api/b2b/analytics
- POST /api/b2b/logout

---

## STORE/STATE MANAGEMENT NEEDED

### Zustand Stores (10+)
- [ ] useVotingStore - User votes and likes
- [ ] useDelegationStore - Delegations and featured delegates
- [ ] useGamificationStore - Civic score, XP, levels, streaks
- [ ] useEngagementStore - Session tracking, unread counts
- [ ] useTimelineStore - Posts, comments, unread
- [ ] useNotificationStore - Notifications
- [ ] useAuthStore - Mock user (for development)
- [ ] useAdminStore - Admin session and stats
- [ ] useB2BStore - B2B session
- [ ] useSeenBillsStore - Session-based bill exclusion

### React Query Keys (30+)
- bills, bills/:id
- feed, feed/trending, feed/gaps
- votes, votes/history
- delegations, delegates, delegates/featured
- users, users/search, users/:id
- posts, posts/:id, posts/:id/comments
- notifications, notifications/unread
- messages, conversations
- admin/stats, admin/users, admin/posts
- b2b/dashboard, b2b/issues, b2b/forecast

---

## DATABASE TABLES NEEDED (Supabase)

- [ ] profiles (users)
- [ ] votes
- [ ] delegations
- [ ] feed_items (posts)
- [ ] feed_comments
- [ ] feed_likes
- [ ] follows
- [ ] messages
- [ ] notifications
- [ ] bills (cache)
- [ ] bill_votes (official)
- [ ] representation_gaps
- [ ] civic_scores
- [ ] admin_logs
- [ ] announcements
- [ ] reports
- [ ] b2b_organizations
- [ ] b2b_issues
- [ ] b2b_forecasts

---

## FEATURES TIGHTLY INTEGRATED INTO MOBILE BUT NEED WEB PARITY

1. **Trust Badge System** - Verify bill data currency and sources
2. **Citizens Brief** - AI-generated simple explanations
3. **Civic Score Levels** - 5-tier engagement system
4. **Feed Reasoning** - Why each bill appears (7+ reasons)
5. **Representation Gap** - Public vs Congress vote comparison
6. **Category Voting** - XP bonuses for voting across all categories
7. **Delegation Validation** - Prevent cycles and self-delegation
8. **Bill Status Tracking** - 8+ status types with real data
9. **Government Structure Display** - Personnel with photos and roles
10. **Engagement Metrics** - Civic Stats per user and aggregated

---

## PRIORITY SEQUENCING RECOMMENDATIONS

**Week 1:** Feed Algorithm + Vote System
**Week 2:** Timeline + Comments + Posts
**Week 3:** Discover Tabs + Government Data
**Week 4:** User Profiles + Follow System
**Week 5:** Delegation System + Gamification
**Week 6:** Notifications + Messaging
**Week 7:** Admin Dashboard
**Week 8:** B2B Portal
**Week 9+:** Polish, Testing, Advanced Features

