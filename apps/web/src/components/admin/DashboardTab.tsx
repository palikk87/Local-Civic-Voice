// Web port of mobile/src/app/admin/dashboard.tsx — platform stats overview.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Skeleton } from "@/components/ui/skeleton";
import { StorageHealthCard } from "@/components/admin/StorageHealthCard";

interface AdminStatsResponse {
  overview?: {
    totalUsers: number;
    totalPosts: number;
    totalComments: number;
    totalVotes: number;
    dailyActiveUsers: number;
    engagementRate: string;
  };
  moderation?: {
    bannedUsers: number;
    flaggedContent: number;
    reportedPosts: number;
    reportedComments: number;
  };
  admins?: {
    totalAdmins: number;
    activeSessions: number;
  };
  error?: string;
}

export function DashboardTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () =>
      api.get<AdminStatsResponse>("/api/admin/stats", { headers: adminAuthHeader() }),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-2 h-8 w-16" />
          </div>
        ))}
      </div>
    );
  }

  const overview = data?.overview;
  const moderation = data?.moderation;
  const admins = data?.admins;

  const stats = [
    { label: "Total Users", value: overview?.totalUsers ?? 0 },
    { label: "Active Today", value: overview?.dailyActiveUsers ?? 0 },
    { label: "Total Posts", value: overview?.totalPosts ?? 0 },
    { label: "Total Comments", value: overview?.totalComments ?? 0 },
    { label: "Total Votes", value: overview?.totalVotes ?? 0 },
    { label: "Engagement Rate", value: `${overview?.engagementRate ?? 0}%` },
    { label: "Banned Users", value: moderation?.bannedUsers ?? 0 },
    { label: "Active Admin Sessions", value: admins?.activeSessions ?? 0 },
  ];

  return (
    <div className="space-y-4">
      <StorageHealthCard />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
            <p className="mt-2 font-display text-2xl font-semibold text-foreground">
              {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
