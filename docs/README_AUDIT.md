# Civic Voice Mobile App - Complete Feature Audit

## Overview

This is a comprehensive audit of the Civic Voice mobile app (React Native/Expo) to identify all features that need to be ported to the web app.

**Audit Date:** July 24, 2026  
**Status:** Complete  
**Finding:** 80% of mobile features are missing from the web app

---

## Audit Documents

### 1. **MOBILE_FEATURE_AUDIT.md** (16 KB, 575 lines)
**Comprehensive Feature Inventory**

The complete feature-by-feature documentation organized by type:
- **Pages (45 total)** - All screens with what they display and APIs they call
  - 5 main tabs (Home Feed, Timeline, Discover, Library, People)
  - 4 detail pages (Bill, Executive Order, Supreme Court, User)
  - 3 education pages (Constitution, Bill of Rights, Article V)
  - 5 engagement pages (Delegates, Messages, Notifications, etc.)
  - 8 admin pages (Dashboard, Users, Posts, Analytics, Logs, etc.)
  - 7 B2B pages (Dashboard, Issues, States, Heatmap, Forecast, Reports, etc.)

- **Library Modules (30+)** - All utility systems with algorithms and APIs
  - Voting system with mock and Supabase integration
  - Delegation system (liquid democracy)
  - Gamification (civic score, levels, streaks)
  - Feed algorithm (5 feed types with ranking)
  - Timeline system (posts, comments)
  - Notification system (8+ types)
  - Authentication (mock and Supabase)
  - Admin system (moderation, analytics)
  - B2B system (business intelligence)
  - Government data (personnel, structure)
  - Trust verification, constitution, representations gaps, etc.

- **Components (15 total)** - All reusable UI elements

**Use This For:** Understanding what each screen/feature does, what data it needs, what APIs it calls, and what's missing.

---

### 2. **FEATURE_PORTING_CHECKLIST.md** (14 KB, 465 lines)
**Actionable Implementation Checklist**

Task-by-task breakdown organized by category:
- **45 Pages to Port** - With checkboxes for tracking
- **10+ Core Systems to Build** - Major features with sub-tasks
- **15 Components to Create** - Reusable UI components
- **30+ Data Structures** - TypeScript interfaces to define
- **120+ API Endpoints** - Backend routes to create
- **20+ Database Tables** - Supabase schema design
- **State Management** - 10+ Zustand stores and React Query keys
- **Priority Sequencing** - Week-by-week implementation roadmap

**Use This For:** Planning implementation, assigning work, tracking progress, estimating timelines.

---

### 3. **AUDIT_SUMMARY.txt** (14 KB)
**Executive Summary with Metrics**

High-level overview with key findings:
- **Key Statistics** - 45 pages, 30+ libraries, 15 components
- **Critical Missing Systems** (12 major)
  1. Feed algorithm (5 feed types with ranking)
  2. Social system (posts, comments, threading)
  3. Delegations (liquid democracy)
  4. Gamification (civic score, levels, streaks)
  5. Notifications (8+ types)
  6. Discovery tabs (4 tabs)
  7. Government data (personnel, structure)
  8. Admin dashboard (moderation, analytics)
  9. B2B portal (business intelligence)
  10. Messaging (direct DMs)
  11. Representation gap display
  12. Trust verification

- **Partially Implemented** - What exists but needs work
- **Effort Estimate** - 400-500 hours (10-12 weeks)
- **Recommended Roadmap** - Week-by-week sequence
- **Team Sizing** - Effort by team size (1-4 developers)

**Use This For:** Getting a quick overview, understanding effort and timeline, presenting to stakeholders.

---

## Key Findings

### What's Entirely Missing (80% of App)

1. **Feed Algorithm** (40-60 hours)
   - 5 feed types: For You, Following, Trending, Gaps, Local
   - Weighted ranking with discovery randomization
   - Representation gap detection
   - Session-based bill exclusion

2. **Social/Timeline System** (30-40 hours)
   - User-generated posts about bills
   - Comments with threading
   - Mention parsing (@username)
   - Like/favorite on posts

3. **Liquid Democracy (Delegations)** (25-35 hours)
   - Category-specific delegations (10 policy categories)
   - Delegation chaining detection
   - Individual vote override (Bill of Rights Article I)
   - Featured delegates showcase

4. **Gamification** (20-30 hours)
   - Civic Score (0-1000+)
   - 5 Civic Levels (Novice → Champion)
   - Daily voting streaks
   - Achievement badges (4+)
   - Category-specific XP bonuses

5. **Notifications** (20-25 hours)
   - 8+ notification types
   - Read/unread tracking
   - Reference linking (to bills, users, posts)
   - Notification settings

6. **Discover Tabs** (25-35 hours)
   - Trending bills with voting
   - Executive orders with metadata
   - Supreme Court cases with justice votes
   - Government map (leadership, cabinet, SCOTUS, departments, succession)

7. **User System Enhancements** (20-30 hours)
   - Civic engagement stats per user
   - Civil Leader ranking/badges
   - User search and discovery
   - Suggested users
   - Follower/following system

8. **Government Data** (20-30 hours)
   - Congressional leadership (Speaker, Majority/Minority Leaders)
   - Cabinet members with departments
   - Supreme Court justices (all 9 with ideology)
   - Presidential succession line
   - Federal government departments

9. **Admin Dashboard** (40-50 hours)
   - System statistics (users, posts, votes, flags)
   - User management (suspend, ban, roles)
   - Content moderation (approve, reject)
   - Analytics with charts
   - Audit logs
   - Announcements system

10. **B2B Analytics Portal** (50-70 hours)
    - Organization dashboard
    - Issue/bill tracking
    - State-by-state analysis
    - Geographic heatmap
    - Bill passage forecasting (ML-based)
    - Report generation and scheduling

### What's Partially Implemented

- User Authentication (needs enhancement)
- Bill Voting (needs representation gap)
- User Profiles (missing civic stats)
- Bill Search (needs full government integration)

### What Needs to be Built

**120+ API Endpoints:**
- 15+ for bills/government
- 8+ for feed
- 10+ for timeline/posts
- 12+ for users/social
- 8+ for delegations
- 8+ for notifications
- 25+ for admin
- 20+ for B2B
- Plus authentication and utilities

**20+ Database Tables:**
- Core: profiles, votes, delegations, feed_items, feed_comments, feed_likes, follows, messages, notifications, civic_scores
- Government: bills, bill_votes, representation_gaps, executive_orders, scotus_cases
- Admin: admin_logs, announcements, b2b_organizations, b2b_issues, b2b_forecasts, reports

**10+ Zustand Stores:**
- Voting, Delegation, Gamification, Engagement, Timeline, Notification
- Auth, Admin, B2B, SeenBills

**30+ React Query Keys:**
- Bills, Feed, Votes, Delegations, Users, Posts, Notifications, Messages
- Admin, B2B specific

---

## Recommended Implementation Sequence

### Phase 1: MVP (Weeks 1-3, ~80-100 hours)
- **Week 1:** Feed algorithm + vote system
- **Week 2:** Timeline + comments + posts
- **Week 3:** Discover tabs + government data

### Phase 2: Core Features (Weeks 4-6, ~100-120 hours)
- **Week 4:** User profiles + follow system
- **Week 5:** Delegation system + gamification
- **Week 6:** Notifications + messaging

### Phase 3: Admin & Polish (Weeks 7-9, ~80-100 hours)
- **Week 7:** Admin dashboard
- **Week 8:** B2B portal
- **Week 9:** Testing & optimization

---

## Effort Estimates

### By System
- Feed Algorithm: 40-60 hours
- Timeline/Comments: 30-40 hours
- Delegations: 25-35 hours
- Gamification: 20-30 hours
- Notifications: 20-25 hours
- Discover Tabs: 25-35 hours
- User System: 20-30 hours
- Government Data: 20-30 hours
- Admin Dashboard: 40-50 hours
- B2B Portal: 50-70 hours
- Components: 30-40 hours
- Testing & Polish: 40-60 hours
- **TOTAL: 400-500 hours**

### By Team Size
- 1 developer: 12 weeks
- 2 developers: 6 weeks
- 3 developers: 4-5 weeks
- 4 developers: 3-4 weeks

---

## Quick Stats

| Metric | Count |
|--------|-------|
| Pages to Port | 45 |
| Library Modules | 30+ |
| Components to Build | 15 |
| API Endpoints Needed | 120+ |
| Database Tables | 20+ |
| Zustand Stores | 10+ |
| React Query Keys | 30+ |
| **Estimated Hours** | **400-500** |
| **Estimated Weeks** | **10-12** |

---

## How to Use These Documents

### For Project Managers
→ Read **AUDIT_SUMMARY.txt**
- Overview, metrics, effort estimate, timeline
- Present to stakeholders for buy-in

### For Architects/Tech Leads
→ Read **MOBILE_FEATURE_AUDIT.md** (relevant sections)
- Understand architecture and data flows
- Plan backend schema
- Design API contracts

### For Developers
→ Read **FEATURE_PORTING_CHECKLIST.md**
- Use as implementation guide
- Track progress with checkboxes
- Reference for each feature being built

### For Everyone
→ **AUDIT_SUMMARY.txt** - Quick reference
- Key findings and impact
- Team sizing and timeline
- Dependencies and next steps

---

## Critical Dependencies

Before starting implementation:
1. **Supabase schema** - Design 20+ tables with RLS policies
2. **API contracts** - Define 120+ endpoints
3. **Feed algorithm** - Implement core ranking logic
4. **Government APIs** - Integrate Congress.gov, Federal Register, etc.
5. **Frontend architecture** - Set up Zustand stores and React Query

---

## Next Steps

1. **Review** - Read AUDIT_SUMMARY.txt for overview
2. **Plan** - Prioritize Phase 1 features
3. **Design** - Create database schema
4. **Build** - Start Phase 1 implementation
5. **Test** - End-to-end testing throughout
6. **Deploy** - Phase by phase release

---

## Summary

The Civic Voice mobile app is a comprehensive civic engagement platform with sophisticated algorithms for bill ranking, liquid democracy delegations, and user engagement tracking. The web app currently lacks 80% of these features.

**Key insight:** The feed algorithm and social system are the highest-impact missing features—implementing these two would bring the web app to 60-70% feature parity and significantly boost engagement.

The audit provides everything needed to plan and execute the porting effort: comprehensive inventory, actionable checklist, effort estimates, and recommended sequence.

---

## Document Locations

All files in `/home/user/workspace/`:
- `MOBILE_FEATURE_AUDIT.md` - Complete inventory (16 KB)
- `FEATURE_PORTING_CHECKLIST.md` - Implementation checklist (14 KB)  
- `AUDIT_SUMMARY.txt` - Executive summary (14 KB)
- `README_AUDIT.md` - This file

**Total: 58 KB of comprehensive documentation**

---

*Audit completed July 24, 2026*
