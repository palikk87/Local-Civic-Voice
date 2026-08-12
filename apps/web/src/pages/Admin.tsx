// Web port of the mobile admin console (mobile/src/app/admin/*) — one page with
// tabs mirroring mobile's screens: Dashboard, Users, Posts, Analytics,
// Announcements, Logs, Settings. All data flows through /api/admin/* with the
// admin bearer token, exactly like mobile.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Shield,
  BarChart3,
  Users,
  FileText,
  LineChart,
  Megaphone,
  ScrollText,
  Settings,
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
import { LogsTab } from "@/components/admin/LogsTab";
import { SettingsTab } from "@/components/admin/SettingsTab";
import { LoadingScreen } from "@/components/LoadingScreen";

export default function Admin() {
  const navigate = useNavigate();
  const [verified, setVerified] = useState<boolean>(false);
  const verifySession = useAdminStore((s) => s.verifySession);

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

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="dashboard">
              <BarChart3 className="mr-2 h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="users">
              <Users className="mr-2 h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="posts">
              <FileText className="mr-2 h-4 w-4" />
              Posts
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <LineChart className="mr-2 h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="announcements">
              <Megaphone className="mr-2 h-4 w-4" />
              Announcements
            </TabsTrigger>
            <TabsTrigger value="logs">
              <ScrollText className="mr-2 h-4 w-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </TabsTrigger>
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
          <TabsContent value="logs" className="mt-6">
            <LogsTab />
          </TabsContent>
          <TabsContent value="settings" className="mt-6">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
