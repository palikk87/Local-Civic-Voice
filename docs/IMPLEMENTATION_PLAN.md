# Civic Voice - Implementation Plan
## Complete Feature Build from A-Z

---

## PHASE 1: CORE SEARCH & ENGAGEMENT (4-6 hours)

### Goal: Make library search results actionable

#### Task 1.1: Fix Library Search Result Click Handler
**File:** `webapp/src/components/library/LibraryResults.tsx`
- Add onClick handlers to result cards
- Navigate to `/reference/:id` when clicked
- Show loading state during navigation
- Handle missing reference (404)

**Acceptance:** Click a library search result → opens reference detail page

#### Task 1.2: Quick Action Bar on Search Results
**File:** `webapp/src/components/library/LibraryResults.tsx`
- Add vote buttons (support/oppose) directly on search result cards
- Add "Add post" button to reference from search
- Show current vote count
- Update counts optimistically

**Acceptance:** Can vote on a reference directly from library search

#### Task 1.3: Reference Detail - Add Related Posts Section
**File:** `webapp/src/pages/ReferenceDetail.tsx`
- Add "Discussions" section showing posts about this reference
- Infinite scroll for posts
- Link to compose new post about this reference
- Show comment count per post

**Acceptance:** Reference detail shows all posts/discussions about it

#### Task 1.4: Reference Detail - Add Full Text Viewer
**File:** `webapp/src/pages/ReferenceDetail.tsx`
- Add collapsible "Full Text" section
- Format bill text nicely (line numbers, highlighting)
- Copy text button
- Download PDF option (if available)

**Acceptance:** Can view full legislative text on reference detail page

---

## PHASE 2: COMMENT & DISCUSSION SYSTEM (8-10 hours)

### Goal: Enable threaded discussions on posts

#### Task 2.1: Comment Display Component
**Files to create:**
- `webapp/src/components/feed/CommentThread.tsx` - Display nested comments
- `webapp/src/components/feed/CommentCard.tsx` - Individual comment UI
- `webapp/src/hooks/use-comments.ts` - React Query hook

**Features:**
- Load comments for a post (paginated)
- Show nested replies
- Display author avatar, name, timestamp
- Show edit/delete buttons for own comments
- Display comment count badge

**API:** GET `/api/posts/:id/comments` (pagination)

**Acceptance:** See threaded comments under each post

#### Task 2.2: Comment Creation UI
**Files to create:**
- `webapp/src/components/feed/ComposeComment.tsx` - Comment input form
- Update `PostCard.tsx` to include comment input toggle

**Features:**
- Text input with emoji picker
- Character counter (max 500)
- "Reply to @user" context
- Submit button with loading state
- Clear after successful post

**API:** POST `/api/posts/:id/comments`

**Acceptance:** Can write and post comments under any post

#### Task 2.3: Comment Editing & Deletion
**File:** `webapp/src/components/feed/CommentCard.tsx`
- Add dropdown menu to own comments
- Edit button → inline edit mode
- Delete button with confirmation
- Show "(edited)" indicator after edit

**API:** PATCH/DELETE `/api/posts/:id/comments/:commentId`

**Acceptance:** Can edit/delete own comments

#### Task 2.4: Nested Replies System
**Files to update:**
- `CommentThread.tsx` - Render reply trees
- `ComposeComment.tsx` - Support "reply to comment"
- `CommentCard.tsx` - Show reply count, expand/collapse

**Features:**
- Click "Reply" → open reply form under comment
- Show which comment you're replying to
- Nest replies up to 3 levels deep
- "Show X more replies" for collapsed threads

**API:** POST `/api/posts/:id/comments/:commentId/replies`

**Acceptance:** Can reply to specific comments and see nested replies

#### Task 2.5: Comment Reactions/Voting
**File:** `webapp/src/components/feed/CommentCard.tsx`
- Add reaction buttons (thumbs up, heart, etc.)
- Show reaction counts
- API integration for comment votes

**API:** POST/DELETE `/api/posts/:id/comments/:commentId/react`

**Acceptance:** Can react to comments with emoji reactions

---

## PHASE 3: DELEGATION & LIQUID DEMOCRACY (6-8 hours)

### Goal: Enable vote delegation system

#### Task 3.1: Delegation Discovery Page
**File to create:** `webapp/src/pages/Delegates.tsx`
- Search for delegates by name/expertise
- Filter by category (healthcare, defense, etc.)
- Show delegate stats: followers, posts, influence score
- Show vote agreement percentage with current user

**Components to create:**
- `DelegateCard.tsx` - Display delegate profile
- `DelegateFilter.tsx` - Category/expertise filters

**API:** GET `/api/users?role=delegate&search=...&category=...`

**Acceptance:** Can search and discover delegates

#### Task 3.2: Delegation Flow UI
**File to create:** `webapp/src/components/civic/DelegationPanel.tsx`
- Quick delegate selector on reference detail
- Modal to select delegate & category
- Show current delegations
- Confirm delegation action

**Features:**
- "Delegate this vote" button on VotePanel
- Select delegate from list/search
- Optional: category-specific delegation
- Show current delegate for category

**API:** POST `/api/users/:id/delegations`, GET `/api/users/:id/delegations`

**Acceptance:** Can delegate vote to another user

#### Task 3.3: User Delegation Management Page
**File to create:** `webapp/src/pages/DelegationManager.tsx`
- Show delegations given (who I delegate to)
- Show delegations received (who delegates to me)
- Revoke delegation button
- Change delegate for category

**API:** GET/DELETE `/api/users/:id/delegations`

**Acceptance:** Can view and manage all delegations

#### Task 3.4: Delegate Badge & Profile Enhancement
**Files to update:**
- `ProfileCard.tsx` / `UserCard.tsx` - Show delegate badge
- `Profile.tsx` - Show delegate stats, categories delegated to me

**Features:**
- Delegate status badge
- Number of active delegations
- Vote weight indicator
- Influence score display

**Acceptance:** User profiles show delegate status and stats

---

## PHASE 4: NOTIFICATION SYSTEM (8-10 hours)

### Goal: Real-time user engagement notifications

#### Task 4.1: Notification Bell & Center
**Files to create:**
- `webapp/src/components/layout/NotificationBell.tsx` - Bell icon with badge
- `webapp/src/pages/Notifications.tsx` - Full notification center
- `webapp/src/hooks/use-notifications.ts` - React Query hook

**Features:**
- Bell icon in header showing unread count
- Click to open notification drawer/page
- List all notifications (paginated)
- Filter by type (likes, comments, follows, etc.)
- Mark as read button per notification
- Mark all as read button

**API:** GET `/api/notifications`, PATCH `/api/notifications/:id`

**Acceptance:** See notification bell and notification center

#### Task 4.2: Notification Types & Display
**File:** `webapp/src/components/notifications/NotificationItem.tsx`
- Display different notification types:
  - Someone liked your post
  - Someone commented on your post
  - Someone replied to your comment
  - Someone mentioned you
  - Someone followed you
  - New delegations received

**Features:**
- Icon per notification type
- Link to relevant content
- Timestamp with relative time (2h ago)
- Unread indicator (blue dot)

**Acceptance:** See typed notifications with context

#### Task 4.3: Notification Preferences UI
**File to create:** `webapp/src/pages/Settings.tsx` (or section in Profile)
- Toggle notification types on/off
- Email notifications preference
- Push notifications preference
- Quiet hours setting
- Do not disturb mode

**API:** PATCH `/api/users/:id/notification-preferences`

**Acceptance:** Can configure notification preferences

#### Task 4.4: Real-time Notifications (Optional but recommended)
**Files to update:** NotificationBell, Notifications page
- WebSocket connection or polling (React Query refetch)
- New notifications appear without page refresh
- Badge updates in real-time
- Toast notification for critical events

**Challenge:** Requires WebSocket setup or polling mechanism
**Alternative:** Use React Query with short refetch interval

**Acceptance:** New notifications appear without manual refresh

---

## PHASE 5: AI CITIZEN BRIEFS (4-6 hours)

### Goal: AI-powered summaries of legislation

#### Task 5.1: Backend: Brief Generation Endpoint
**File to create:** `backend/src/routes/briefs.ts`
- Endpoint: POST `/api/briefs/generate`
- Input: reference ID
- Call OpenAI API with legislation text
- Return: structured brief with sections (summary, pros, cons, impact)
- Cache results to avoid re-generation

**Features:**
- Use existing OpenAI key from env
- Prompt engineering for civic context
- Store generated briefs in database
- Return brief + meta (generated date, model used)

**Schema to add to types.ts:**
```typescript
export const briefSchema = z.object({
  id: z.string(),
  referenceId: z.string(),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  impactAreas: z.array(z.string()),
  generatedAt: z.string().datetime(),
});
```

**Acceptance:** Can generate AI briefs on backend

#### Task 5.2: Frontend: Brief Display Component
**File to create:** `webapp/src/components/civic/CitizenBrief.tsx`
- Display brief sections: Summary, Key Points, Pros/Cons, Impact
- Loading skeleton while generating
- Refresh button to regenerate
- Quote/share functionality
- Print-friendly format

**Features:**
- Nice formatting with icons
- Collapsible sections
- Citation format
- "AI generated" disclaimer

**Acceptance:** Can view generated briefs on reference detail page

#### Task 5.3: Brief Display on Reference Detail
**File to update:** `webapp/src/pages/ReferenceDetail.tsx`
- Add "AI Brief" tab/section
- Show brief if exists, "Generate" button if not
- Loading state during generation
- Error handling

**API:** GET `/api/briefs/:referenceId`, POST `/api/briefs/generate`

**Acceptance:** Reference detail shows AI brief summary

#### Task 5.4: Brief Caching & Management
**Files:**
- Add `Brief` model to Prisma schema
- Implement brief caching in backend service
- Clean up old briefs (retention policy)

**Features:**
- Store briefs in database
- Only regenerate if > 7 days old
- Cache brief generation for performance
- Show "Last updated" date

**Acceptance:** Briefs are cached and reused across users

---

## PHASE 6: ADMIN DASHBOARD (10-12 hours)

### Goal: Platform governance and content moderation

#### Task 6.1: Admin Route Guard & Layout
**Files to create:**
- `webapp/src/pages/Admin/Dashboard.tsx` - Main admin page
- `webapp/src/components/admin/AdminLayout.tsx` - Admin-specific layout
- `webapp/src/lib/admin.ts` - Admin utility functions
- Update `App.tsx` routes

**Features:**
- Check user.role === 'admin' before rendering
- Separate sidebar navigation for admin
- Breadcrumbs showing admin section
- Logout button from admin

**Acceptance:** Admin users can access `/admin` routes

#### Task 6.2: User Management Section
**File to create:** `webapp/src/pages/Admin/Users.tsx`
- List all users (paginated)
- Search by name/email
- Filter by role (user, moderator, admin)
- Sort by join date, activity, votes
- User detail modal showing:
  - Profile info
  - Post count
  - Vote count
  - Flag count
  - Ban status

**Components:**
- `UserTable.tsx` - Searchable user list
- `UserDetailModal.tsx` - User actions modal
- `UserActions.tsx` - Ban, warn, promote, etc.

**API:** GET `/api/admin/users`, GET `/api/admin/users/:id`, PATCH `/api/admin/users/:id`

**Acceptance:** Can view and manage all users

#### Task 6.3: Content Moderation Section
**File to create:** `webapp/src/pages/Admin/Moderation.tsx`
- List flagged content (posts, comments, references)
- Filter by status: pending, approved, rejected
- Filter by severity: spam, harassment, misinformation
- View content in context
- Actions: approve, remove, warn user

**Components:**
- `FlaggedContentList.tsx` - Content queue
- `ContentPreview.tsx` - Full context view
- `ModerationActions.tsx` - Action buttons

**API:** GET `/api/admin/flags`, PATCH `/api/admin/flags/:id`

**Acceptance:** Can moderate flagged content

#### Task 6.4: Analytics Dashboard
**File to create:** `webapp/src/pages/Admin/Analytics.tsx`
- Key metrics:
  - Total users, active users, new users this week
  - Total posts, total votes, engagement rate
  - Top references by engagement
  - Trending topics
  - Report generation

**Components:**
- `MetricsCard.tsx` - Stats display
- `TrendingChart.tsx` - Line chart of activity
- `TopReferences.tsx` - Ranking table
- `ReportGenerator.tsx` - Generate CSV reports

**Challenge:** Need analytics aggregation in backend
**Solution:** Leverage existing CreatorMetrics, PostMetrics models

**Acceptance:** Can view platform analytics

#### Task 6.5: Admin Settings
**File to create:** `webapp/src/pages/Admin/Settings.tsx`
- Platform-wide settings:
  - Maintenance mode toggle
  - Feature flags (enable/disable AI briefs, delegations, etc.)
  - Rate limit configuration
  - Message templates
  - Mod queue priority
  - API key management

**Components:**
- `SettingsForm.tsx` - Form with toggles/inputs
- `FeatureFlags.tsx` - Feature flag management

**API:** GET/PATCH `/api/admin/settings`

**Acceptance:** Can configure platform settings

---

## PHASE 7: ENHANCED USER PROFILES & FEED (6-8 hours)

### Goal: Rich user profiles and better feed discovery

#### Task 7.1: Detailed User Profile Page
**File to update:** `webapp/src/pages/Profile.tsx` (or create `PublicProfile.tsx`)
- User header: avatar, name, bio, join date, location
- Stats tabs:
  - Posts (grid of posts)
  - Votes (voting history with breakdown)
  - Followers/Following lists
  - Delegations (who delegates to them)
- Follow/Unfollow button (if viewing other user)
- Message button
- Influence/reputation score

**Components:**
- `ProfileHeader.tsx` - User info
- `ProfileTabs.tsx` - Tabbed content
- `UserPostsGrid.tsx` - Posts by user
- `VotingHistory.tsx` - All votes user made
- `FollowersList.tsx` / `FollowingList.tsx`

**API:** GET `/api/users/:id`, GET `/api/users/:id/posts`, GET `/api/users/:id/votes`

**Acceptance:** Can view detailed user profiles

#### Task 7.2: Delegation Management Page
**File to create:** `webapp/src/pages/DelegationManager.tsx`
- Active delegations section: show who I delegate to
- Receive delegations section: show who delegates to me
- Voting power tracker: base votes + delegated votes
- Categories breakdown: show votes per category
- Actions: add delegation, revoke delegation, change delegate

**Components:**
- `DelegationCard.tsx` - Delegation display
- `DelegationStats.tsx` - Power/stats visualization
- `DelegationForm.tsx` - Add/edit delegation

**API:** GET/POST/DELETE `/api/users/:id/delegations`

**Acceptance:** Can manage delegations from dedicated page

#### Task 7.3: Voting History & Stats
**File to create:** `webapp/src/pages/VotingHistory.tsx`
- List all votes user made (paginated)
- Filter by reference type, time period, position
- Show consistency metrics (agreement with similar voters)
- Compare voting patterns to aggregated voters
- Export voting history CSV

**Components:**
- `VotingHistoryList.tsx` - Vote list
- `VotingStats.tsx` - Stats cards
- `VotingComparison.tsx` - Comparison to peers

**API:** GET `/api/users/:id/votes`, GET `/api/users/:id/voting-stats`

**Acceptance:** Can view voting history and patterns

#### Task 7.4: Trending References Exploration
**File to create:** `webapp/src/pages/Trending.tsx`
- Show trending references by timeframe (24h, 7d, 30d, all-time)
- Show trending topics/categories
- Show trending delegates
- Show trending posts
- Interactive charts of engagement trends

**Components:**
- `TrendingReferences.tsx` - Trending legislation
- `TrendingTopics.tsx` - Topics breakdown
- `TrendingDelegates.tsx` - Popular delegates
- `TrendingPosts.tsx` - Viral posts

**API:** GET `/api/government-references/trending`, GET `/api/posts/trending`

**Acceptance:** Can explore trending content and delegates

#### Task 7.5: Feed Personalization Settings
**File to create:** Section in Settings page
- Preferred categories (checkboxes)
- Follow/unfollow categories
- Block users/topics
- Mute keywords
- Diversify vs. echo chamber slider

**Features:**
- Save preferences to UserFeedProfile model
- Feed algorithm uses preferences
- Instant apply (real-time feed update)

**API:** GET/PATCH `/api/users/:id/feed-preferences`

**Acceptance:** Users can customize what they see in feed

---

## PHASE 8: SEARCH IMPROVEMENTS (3-4 hours)

### Goal: Better search and discovery across the app

#### Task 8.1: Global Search Page
**File to create:** `webapp/src/pages/Search.tsx`
- Unified search across all types:
  - References (bills, EOs, cases)
  - Users
  - Topics/categories
  - Delegates
- Tab-based results
- Quick filters per tab
- Search history (localStorage)
- Recent searches dropdown

**Components:**
- `SearchInput.tsx` - Search bar with autocomplete
- `SearchResults.tsx` - Tabbed results
- `SearchHistory.tsx` - Recent searches

**API:** GET `/api/search?q=...&type=...`

**Acceptance:** Can search everything from one place

#### Task 8.2: Autocomplete/Suggestions
**File:** `webapp/src/components/SearchInput.tsx`
- Debounced autocomplete as user types
- Suggest references, users, delegates
- Show icons per type
- Quick access to recent

**API:** GET `/api/search/suggestions?q=...`

**Acceptance:** Search suggestions appear while typing

#### Task 8.3: Search Filters & Advanced Search
**Files:**
- `webapp/src/pages/Search.tsx`
- `webapp/src/components/SearchFilters.tsx`

**Features:**
- Advanced search page with filters
- Date range filter (for references)
- Status filter (passed, pending, etc.)
- Category filter
- Save search as bookmark

**Acceptance:** Can do advanced filtered searches

---

## ADDITIONAL IMPROVEMENTS

### Task 9.1: Post Media Support
**Files to update:**
- `ComposeCard.tsx` - Add image/video upload
- `PostCard.tsx` - Display media
- `backend/src/routes/media.ts` - Improve media handling

**Features:**
- Upload images/videos when composing
- Preview before posting
- Lightbox view for full media
- Video playback

### Task 9.2: Share to Social
**Files:**
- `PostCard.tsx` - Add share button
- `ReferenceDetail.tsx` - Add share button
- Create share modal with socials (Twitter, LinkedIn, Copy Link)

### Task 9.3: Saved Posts / Reading List
**Files to create:**
- `webapp/src/pages/Saved.tsx` - Saved posts collection
- Update `PostCard.tsx` - Save button
- Update sidebar navigation

**Features:**
- View all saved posts
- Collections (create custom collections)
- Export reading list

### Task 9.4: Mentions & Tagging
**Files:**
- Update `ComposeCard.tsx` - @ mentions
- Update `CommentCard.tsx` - @ mentions
- Show mentions in notifications

### Task 9.5: Hashtag System
**Files:**
- Update `ComposeCard.tsx` - # hashtag input
- Create `HashtagFeed.tsx` - Posts by hashtag
- Update trending to show trending hashtags

---

## PHASE 9: POLISH & LAUNCH (4-6 hours)

### Task 9.1: Performance Optimization
- Image optimization (lazy loading, compression)
- Code splitting per route
- Caching strategy improvements
- Database query optimization

### Task 9.2: Error Handling & Edge Cases
- Better error messages
- Fallback UI for failed loads
- Retry mechanisms
- Offline detection

### Task 9.3: Mobile Responsiveness
- Test all new features on mobile
- Adjust layouts for small screens
- Touch-friendly buttons
- Mobile-optimized navigation

### Task 9.4: Accessibility
- ARIA labels for all interactive elements
- Keyboard navigation
- Color contrast checks
- Screen reader testing

### Task 9.5: Analytics & Tracking
- Track user actions for insights
- Track feature usage
- Track errors
- Setup analytics dashboard

---

## ESTIMATED TIMELINE

| Phase | Tasks | Hours | Weeks |
|-------|-------|-------|-------|
| 1. Search & Engagement | 4 | 4-6 | 1 |
| 2. Comments | 5 | 8-10 | 1.5 |
| 3. Delegation | 4 | 6-8 | 1 |
| 4. Notifications | 4 | 8-10 | 1.5 |
| 5. AI Briefs | 4 | 4-6 | 1 |
| 6. Admin Dashboard | 5 | 10-12 | 2 |
| 7. Profiles & Feed | 5 | 6-8 | 1 |
| 8. Search Improvements | 3 | 3-4 | 0.5 |
| 9. Polish & Launch | 5 | 4-6 | 1 |
| **TOTAL** | **39** | **53-70 hours** | **10-11 weeks** |

---

## IMPLEMENTATION STRATEGY

### Start with Phase 1 (This Week)
- It's quick (4-6 hours)
- Unlocks core functionality
- Makes library search useful
- Shows immediate progress

### Then do Phase 2 & 3 in parallel
- Comments (8-10h) + Delegation (6-8h) = 14-18h
- Both are core civic features
- Take 2 weeks
- After this, app is 70% feature-complete

### Then Phases 4-6 (3-4 weeks)
- Notifications (8-10h)
- AI Briefs (4-6h)
- Admin (10-12h)
- These add engagement and governance

### Finally Phases 7-9 (2-3 weeks)
- Polish and complete

---

## FRONTEND ARCHITECTURE CHANGES NEEDED

### New Hooks to Create
- `useComments(postId)` - Comments React Query
- `useNotifications()` - Notifications React Query
- `useDelegations()` - Delegations React Query  
- `useBrief(referenceId)` - Brief generation
- `useAdmin()` - Admin auth check
- `useSearch()` - Global search

### New Pages to Create
- `/delegates` - Delegate discovery
- `/notifications` - Notification center
- `/delegations` - Delegation management
- `/admin/*` - Admin dashboard
- `/saved` - Saved posts
- `/trending` - Trending content
- `/voting-history` - Voting stats
- `/search` - Global search
- `/settings` - User settings

### Components to Create (~40 new)
- Comment system (5 components)
- Delegation UI (4 components)
- Notification system (4 components)
- Admin dashboard (10 components)
- Profile enhancements (8 components)
- Search improvements (4 components)
- Miscellaneous improvements (5 components)

### Database Migrations Needed
- Add `Brief` model (for AI briefs)
- Possibly expand `User` model for admin fields
- All other models already exist

---

## SUCCESS CRITERIA

By end of Phase 9, users should be able to:
- ✅ Search legislation and engage with results
- ✅ Comment and discuss on posts
- ✅ Delegate votes to other users
- ✅ Receive and manage notifications
- ✅ Read AI-generated briefs
- ✅ Discover and follow delegates
- ✅ View detailed voting history
- ✅ Access admin moderation tools (admins only)
- ✅ Customize feed preferences
- ✅ Share content to social media
- ✅ Save posts for later
- ✅ Manage profile and delegations
- ✅ Get real-time notifications

**At that point, the app becomes a fully functional civic engagement platform.**
