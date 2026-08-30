import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import { AuthUIProvider } from "@/hooks/use-civic-auth";
import { VoteAnonymityDialog } from "@/components/civic/VoteAnonymityDialog";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { LoadingScreen } from "@/components/LoadingScreen";
import { SyncSignedInIdentity } from "@/lib/mobile/signed-in-identity";

const Landing = lazy(() => import("./pages/Landing"));
const Feed = lazy(() => import("./pages/Feed"));
const Timeline = lazy(() => import("./pages/Timeline"));
const Discover = lazy(() => import("./pages/Discover"));
const People = lazy(() => import("./pages/People"));
const Government = lazy(() => import("./pages/Government"));
const Library = lazy(() => import("./pages/Library"));
const ReferenceDetail = lazy(() => import("./pages/ReferenceDetail"));
const JuryCasePage = lazy(() => import("./pages/JuryCase"));
const Documents = lazy(() => import("./pages/Documents"));
const Constitution = lazy(() => import("./pages/Constitution"));
const BillOfRights = lazy(() => import("./pages/BillOfRights"));
const ArticleV = lazy(() => import("./pages/ArticleV"));
const Terms = lazy(() => import("./pages/Terms"));
const Profile = lazy(() => import("./pages/Profile"));
const Auth = lazy(() => import("./pages/Auth"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Notifications = lazy(() => import("./pages/Notifications"));
const CivicScore = lazy(() => import("./pages/CivicScore"));
const Messages = lazy(() => import("./pages/Messages"));
const Conversation = lazy(() => import("./pages/Conversation"));
const Delegates = lazy(() => import("./pages/Delegates"));
const Saved = lazy(() => import("./pages/Saved"));
const Trending = lazy(() => import("./pages/Trending"));
const VotingHistory = lazy(() => import("./pages/VotingHistory"));
const Settings = lazy(() => import("./pages/Settings"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));
const B2BLogin = lazy(() => import("./pages/b2b/B2BLogin"));
const B2BDashboard = lazy(() => import("./pages/b2b/B2BDashboard"));
const B2BIssues = lazy(() => import("./pages/b2b/B2BIssues"));
const B2BHeatmap = lazy(() => import("./pages/b2b/B2BHeatmap"));
const B2BForecast = lazy(() => import("./pages/b2b/B2BForecast"));
const B2BReports = lazy(() => import("./pages/b2b/B2BReports"));
const B2BStates = lazy(() => import("./pages/b2b/B2BStates"));
const B2BSettings = lazy(() => import("./pages/b2b/B2BSettings"));
const B2BAdmin = lazy(() => import("./pages/b2b/B2BAdmin"));
const Search = lazy(() => import("./pages/Search"));
/*
 * BillDetail, ExecutiveOrderDetail and ScotusDetail were deleted here.
 *
 * They were three ports of the phone app, one per branch, showing the same
 * government record three slightly different ways — and between them they were
 * what almost every link in this app opened. Meanwhile /reference/:id, the page
 * with the Citizen's Brief, the Integrity Audit, the Pulse history, the turning
 * points, the other side and the comments, was reachable from a profile's
 * record and very little else.
 *
 * Everything they had that the reference page did not — the sponsor, the
 * introduced and last-action dates, the Gap, and sharing to your timeline — was
 * moved across first. One thing was deliberately left behind: BillDetail's news
 * carousel read `mockNewsReels`, a hand-written list of invented clips with
 * fake video URLs. It is not a feature, and it is not coming with us.
 *
 * The routes live on as redirects, in LawRedirect, because links to them exist
 * in notifications and in posts people have already shared.
 */
const UserProfile = lazy(() => import("./pages/UserProfile"));
const PersonRecord = lazy(() => import("./pages/PersonRecord"));
const LawRedirect = lazy(() => import("./pages/LawRedirect"));
const PostDetail = lazy(() => import("./pages/PostDetail"));
const StartHere = lazy(() => import("./pages/StartHere"));
const HashtagPage = lazy(() => import("./pages/HashtagPage"));
const MyRecord = lazy(() => import("./pages/MyRecord"));
const PositionReview = lazy(() => import("./pages/PositionReview"));
const NotFound = lazy(() => import("./pages/NotFound"));

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner position="top-center" />
      <BrowserRouter>
        <AuthUIProvider>
          <SyncSignedInIdentity />
          {/* Mounted once, above the routes, because the thing that raises the
              question is the vote pipeline rather than any one screen — every
              surface in the app votes through the same function. */}
          <VoteAnonymityDialog />
          <Suspense fallback={<LoadingScreen />}>
            <Routes>
              {/* ---- Public: anyone can read the civic record ---- */}
              <Route path="/" element={<Feed />} />
              <Route path="/landing" element={<Landing />} />
              <Route path="/feed" element={<Feed />} />
              <Route path="/explore" element={<Navigate to="/discover" replace />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/people" element={<People />} />
              <Route path="/government" element={<Government />} />
              <Route path="/reps" element={<Navigate to="/government" replace />} />
              {/* /analytics is deliberately not mounted.
                  It was a page whose entire content was the words "Loading
                  Analytics…", with no query behind them — so it said it was
                  loading something that was never going to arrive, to every
                  visitor, on a perfectly healthy server. Nothing linked to it.
                  A 404 is a true statement; a permanent spinner is not.
                  Real analytics live at /admin/analytics and in the B2B
                  portal, both of which fetch real numbers. */}
              <Route path="/library" element={<Library />} />
              <Route path="/reference/:id" element={<ReferenceDetail />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/constitution" element={<Constitution />} />
              <Route path="/bill-of-rights" element={<BillOfRights />} />
              <Route path="/article-v" element={<ArticleV />} />
              {/* Article IV. Reachable signed out too: a decided case is public. */}
              <Route path="/jury/:id" element={<JuryCasePage />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/trending" element={<Trending />} />
              <Route path="/search" element={<Search />} />

              {/* ---- Members only: personal surfaces ---- */}
              <Route
                path="/timeline"
                element={
                  <RouteGuard capability="viewTimeline" reason="Your timeline is your personal feed of the people and bills you follow.">
                    <Timeline />
                  </RouteGuard>
                }
              />
              <Route
                path="/profile"
                element={
                  <RouteGuard capability="viewProfile" reason="Sign in to view your profile and civic record.">
                    <Profile />
                  </RouteGuard>
                }
              />
              <Route
                path="/messages"
                element={
                  <RouteGuard capability="viewMessages" reason="Sign in to read your messages.">
                    <Messages />
                  </RouteGuard>
                }
              />
              {/* The plaque on the feed opens this. It used to open the
                  reader's profile, which is not what the plaque is about. */}
              <Route
                path="/civic-score"
                element={
                  <RouteGuard capability="viewMessages" reason="Sign in to see your civic score.">
                    <CivicScore />
                  </RouteGuard>
                }
              />
              <Route
                path="/conversation/:id"
                element={
                  <RouteGuard capability="viewMessages" reason="Sign in to read your messages.">
                    <Conversation />
                  </RouteGuard>
                }
              />
              <Route
                path="/notifications"
                element={
                  <RouteGuard capability="viewNotifications" reason="Sign in to see your notifications.">
                    <Notifications />
                  </RouteGuard>
                }
              />
              <Route
                path="/delegates"
                element={
                  <RouteGuard capability="viewDelegates" reason="Sign in to manage who you delegate your vote to.">
                    <Delegates />
                  </RouteGuard>
                }
              />
              <Route
                path="/saved"
                element={
                  <RouteGuard capability="viewSaved" reason="Sign in to see the bills and cases you've saved.">
                    <Saved />
                  </RouteGuard>
                }
              />
              <Route
                path="/voting-history"
                element={
                  <RouteGuard capability="viewVotingHistory" reason="Sign in to see how you've voted.">
                    <VotingHistory />
                  </RouteGuard>
                }
              />
              <Route
                path="/settings"
                element={
                  <RouteGuard capability="viewSettings" reason="Sign in to manage your account settings.">
                    <Settings />
                  </RouteGuard>
                }
              />

              {/* ---- Administrators only (separate admin-console login) ---- */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route
                path="/admin"
                element={
                  <RouteGuard capability="viewAdmin" reason="Sign in with an administrator account to open the admin console.">
                    <Admin />
                  </RouteGuard>
                }
              />
              <Route
                path="/admin/:tab"
                element={
                  <RouteGuard capability="viewAdmin" reason="Sign in with an administrator account to open the admin console.">
                    <Admin />
                  </RouteGuard>
                }
              />
              {/* ---- B2B Analytics portal (separate B2B login; pages self-guard) ---- */}
              <Route path="/b2b/login" element={<B2BLogin />} />
              <Route path="/b2b" element={<Navigate to="/b2b/dashboard" replace />} />
              <Route path="/b2b/dashboard" element={<B2BDashboard />} />
              <Route path="/b2b/issues" element={<B2BIssues />} />
              <Route path="/b2b/heatmap" element={<B2BHeatmap />} />
              <Route path="/b2b/forecast" element={<B2BForecast />} />
              <Route path="/b2b/reports" element={<B2BReports />} />
              <Route path="/b2b/states" element={<B2BStates />} />
              <Route path="/b2b/settings" element={<B2BSettings />} />
              <Route path="/b2b/admin" element={<B2BAdmin />} />
              <Route path="/auth" element={<Auth />} />
              {/* Same path as the mobile route, so a reset link works on either client. */}
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/user/:id" element={<UserProfile />} />
              {/* Somebody else's positions, on their own page. Public, like the
                  profile it hangs off — the click is the point, not a gate. */}
              <Route path="/user/:id/record" element={<PersonRecord />} />
              <Route path="/post/:id" element={<PostDetail />} />
              <Route path="/start" element={<StartHere />} />
              <Route path="/hashtag/:tag" element={<HashtagPage />} />
              <Route path="/record" element={<MyRecord />} />
              <Route path="/record/review" element={<PositionReview />} />
              {/* One law, one page. These three were ports of the phone app,
                  one per branch, and between them they were what almost every
                  link in the app opened — while the page with the brief, the
                  audit, the gap and the comments sat behind a profile's record.
                  Kept as redirects because links to them exist in notifications
                  and in posts people have already shared. See LawRedirect. */}
              <Route path="/bill/:id" element={<LawRedirect />} />
              <Route path="/executive-order/:id" element={<LawRedirect />} />
              <Route path="/scotus/:id" element={<LawRedirect />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <AuthDialog />
        </AuthUIProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
