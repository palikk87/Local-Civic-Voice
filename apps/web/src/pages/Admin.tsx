// Web port of the mobile admin console (mobile/src/app/admin/*) — one page with
// tabs mirroring mobile's screens: Dashboard, Users, Posts, Analytics,
// Announcements, Logs, Settings. All data flows through /api/admin/* with the
// admin bearer token, exactly like mobile.
//
// Mobile addresses those screens as eight separate URLs (/admin/users,
// /admin/logs, …). This page is reachable at each of them too: App.tsx routes
// /admin/:tab here, and the tab is read from the URL rather than held only in
// component state. Without that, an admin link sent from a phone 404s in a
// browser — the two clients are meant to be one product.
//
// The tab is kept in the URL both ways: opening /admin/logs selects Logs, and
// clicking Logs rewrites the address bar, so the browser Back button and a
// copied link both behave the way people expect them to.
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Shield,
  ShieldCheck,
  BarChart3,
  Users,
  FileText,
  LineChart,
  Megaphone,
  Building2,
  GitMerge,
  ScrollText,
  Wrench,
  Settings,
  Bug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/layout/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAdminStore } from "@/lib/mobile/admin-store";
import { DashboardTab } from "@/components/admin/DashboardTab";
import { UsersTab } from "@/components/admin/UsersTab";
import { PostsTab } from "@/components/admin/PostsTab";
import { AnalyticsTab } from "@/components/admin/AnalyticsTab";
import { AnnouncementsTab } from "@/components/admin/AnnouncementsTab";
import { B2BClientsTab } from "@/components/admin/B2BClientsTab";
import { MergeReviewTab } from "@/components/admin/MergeReviewTab";
import { LogsTab } from "@/components/admin/LogsTab";
import { SettingsTab } from "@/components/admin/SettingsTab";
import { BugReportsTab } from "@/components/admin/BugReportsTab";
import { MaintenanceTab } from "@/components/admin/MaintenanceTab";
import { RolesTab } from "@/components/admin/RolesTab";
import { LoadingScreen } from "@/components/LoadingScreen";

/** Tabs this console renders — and, one-for-one, mobile's /admin/* screen names. */
const ADMIN_TABS = [
  "dashboard",
  "users",
  "posts",
  "analytics",
  "announcements",
  "merge-review",
  "b2b-clients",
  // "bug-reports" had a tab trigger but was missing from this list, so the URL
  // /admin/bug-reports fell back to the dashboard on a reload or a shared link
  // — the tab worked, the address did not.
  "bug-reports",
  "roles",
  "maintenance",
  "logs",
  "settings",
] as const;

type AdminTab = (typeof ADMIN_TABS)[number];

/**
 * The capability each tab needs, matching what the server checks on the calls
 * that tab makes.
 *
 * Roles are configurable now, so "which tabs do I get" cannot be answered by
 * the role's name. A tab with no entry here is open to anybody who can sign
 * into the console at all — Dashboard is the one such tab, deliberately, so a
 * role granted nothing still lands somewhere rather than on a blank console.
 */
const TAB_CAPABILITY: Partial<Record<AdminTab, string>> = {
  users: "users.view",
  posts: "posts.moderate",
  analytics: "analytics.view",
  announcements: "announcements.write",
  "merge-review": "merges.decide",
  "b2b-clients": "b2b.view",
  "bug-reports": "bugReports.manage",
  roles: "roles.manage",
  maintenance: "content.repair",
  logs: "logs.view",
  settings: "keys.manage",
};

function isAdminTab(value: string | undefined): value is AdminTab {
  return !!value && (ADMIN_TABS as readonly string[]).includes(value);
}

export default function Admin() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const [verified, setVerified] = useState<boolean>(false);
  const verifySession = useAdminStore((s) => s.verifySession);
  const session = useAdminStore((s) => s.session);

  const allows = (capability: string | undefined) => {
    if (!capability) return true;
    if (!session) return false;
    // The owner seat holds everything, including capabilities added later.
    if (session.role === "superadmin") return true;
    return session.capabilities.includes(capability);
  };

  // An unrecognised tab falls back to dashboard rather than rendering an empty
  // console. So does a tab this role has not been granted — following a link to
  // /admin/logs without "logs.view" should land somewhere honest, not on a
  // panel whose every request comes back 403.
  const requested: AdminTab = isAdminTab(tab) ? tab : "dashboard";
  const activeTab: AdminTab = allows(TAB_CAPABILITY[requested]) ? requested : "dashboard";

  // The console requires a live admin-console session — same rule as mobile.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const valid = await verifySession();
      if (cancelled) return;
      if (!valid) {
        navigate("/admin/login", { replace: true });
      } else {
        setVerified(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verifySession, navigate]);

  if (!verified) {
    return <LoadingScreen />;
  }

  return (
    <AppShell wide>
      <div className="space-y-5">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/profile")}
            className="-ml-2 mb-2 text-muted-foreground"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            <Shield className="h-6 w-6 text-accent" />
            Admin Console
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage users, content, analytics, and platform communications.
          </p>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(next) => navigate(`/admin/${next}`)}
          className="w-full"
        >
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="dashboard">
              <BarChart3 className="mr-2 h-4 w-4" />
              Dashboard
            </TabsTrigger>
            {allows(TAB_CAPABILITY["users"]) ? (
              <TabsTrigger value="users">
                <Users className="mr-2 h-4 w-4" />
                Users
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["posts"]) ? (
              <TabsTrigger value="posts">
                <FileText className="mr-2 h-4 w-4" />
                Posts
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["analytics"]) ? (
              <TabsTrigger value="analytics">
                <LineChart className="mr-2 h-4 w-4" />
                Analytics
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["announcements"]) ? (
              <TabsTrigger value="announcements">
                <Megaphone className="mr-2 h-4 w-4" />
                Announcements
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["merge-review"]) ? (
              <TabsTrigger value="merge-review">
                <GitMerge className="mr-2 h-4 w-4" />
                Merge review
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["b2b-clients"]) ? (
              <TabsTrigger value="b2b-clients">
                <Building2 className="mr-2 h-4 w-4" />
                B2B clients
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["bug-reports"]) ? (
              <TabsTrigger value="bug-reports">
                <Bug className="mr-2 h-4 w-4" />
                Bug reports
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["roles"]) ? (
              <TabsTrigger value="roles">
                <ShieldCheck className="mr-2 h-4 w-4" />
                Roles
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["maintenance"]) ? (
              <TabsTrigger value="maintenance">
                <Wrench className="mr-2 h-4 w-4" />
                Maintenance
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["logs"]) ? (
              <TabsTrigger value="logs">
                <ScrollText className="mr-2 h-4 w-4" />
                Logs
              </TabsTrigger>
            ) : null}
            {allows(TAB_CAPABILITY["settings"]) ? (
              <TabsTrigger value="settings">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="dashboard" className="mt-6">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="users" className="mt-6">
            <UsersTab />
          </TabsContent>
          <TabsContent value="posts" className="mt-6">
            <PostsTab />
          </TabsContent>
          <TabsContent value="analytics" className="mt-6">
            <AnalyticsTab />
          </TabsContent>
          <TabsContent value="announcements" className="mt-6">
            <AnnouncementsTab />
          </TabsContent>
          <TabsContent value="merge-review" className="mt-6">
            <MergeReviewTab />
          </TabsContent>
          <TabsContent value="b2b-clients" className="mt-6">
            <B2BClientsTab />
          </TabsContent>
          <TabsContent value="roles" className="mt-6">
            <RolesTab />
          </TabsContent>

          <TabsContent value="maintenance" className="mt-6">
            <MaintenanceTab />
          </TabsContent>
          <TabsContent value="logs" className="mt-6">
            <LogsTab />
          </TabsContent>
          <TabsContent value="bug-reports" className="mt-6">
            <BugReportsTab />
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
