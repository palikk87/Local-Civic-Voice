// Web port of mobile/src/app/admin/analytics.tsx — engagement + growth analytics.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Skeleton } from "@/components/ui/skeleton";

interface EngagementResponse {
  period: string;
  data: Array<{ date: string; posts: number; comments: number; likes: number; votes: number }>;
  totals: { posts: number; comments: number; likes: number; votes: number };
}

interface GrowthResponse {
  period: string;
  data: Array<{ date: string; newUsers: number; totalUsers: number; activeUsers: number }>;
  summary: { totalNewUsers: number; averageActiveUsers: number; growthRate: string };
}

function BarChart({
  data,
  color,
  label,
}: {
  data: Array<{ date: string; value: number }>;
  color: string;
  label: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5">
        {data.map((d) => (
          <div key={d.date} className="group relative flex flex-1 flex-col items-center self-stretch justify-end">
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(3, (d.value / max) * 100)}%`, backgroundColor: color }}
              title={`${d.date}: ${d.value} ${label}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.date?.slice(5)}</span>
        <span>{data[data.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}

export function AnalyticsTab() {
  const { data: engagement, isLoading: engagementLoading } = useQuery({
    queryKey: ["admin-engagement"],
    queryFn: () =>
      api.get<EngagementResponse>("/api/admin/stats/engagement", { headers: adminAuthHeader() }),
  });

  const { data: growth, isLoading: growthLoading } = useQuery({
    queryKey: ["admin-growth"],
    queryFn: () =>
      api.get<GrowthResponse>("/api/admin/stats/growth", { headers: adminAuthHeader() }),
  });

  if (engagementLoading || growthLoading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Posts this week", value: engagement?.totals?.posts ?? 0 },
          { label: "Comments this week", value: engagement?.totals?.comments ?? 0 },
          { label: "Likes this week", value: engagement?.totals?.likes ?? 0 },
          { label: "Votes this week", value: engagement?.totals?.votes ?? 0 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{stat.label}</p>
            <p className="mt-1 font-display text-2xl font-semibold text-foreground">
              {stat.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Engagement chart */}
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 font-medium text-foreground">Daily Posts (last 7 days)</p>
          <BarChart
            data={(engagement?.data ?? []).map((d) => ({ date: d.date, value: d.posts }))}
            color="hsl(var(--primary))"
            label="posts"
          />
        </div>

        {/* Growth chart */}
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 font-medium text-foreground">New Users (last 7 days)</p>
          <BarChart
            data={(growth?.data ?? []).map((d) => ({ date: d.date, value: d.newUsers }))}
            color="#10B981"
            label="new users"
          />
        </div>
      </div>

      {/* Growth summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">New users this week</p>
          <p className="mt-1 font-display text-2xl font-semibold text-foreground">
            {growth?.summary?.totalNewUsers ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Avg daily active users</p>
          <p className="mt-1 font-display text-2xl font-semibold text-foreground">
            {growth?.summary?.averageActiveUsers ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Growth rate</p>
          <p className="mt-1 font-display text-2xl font-semibold text-foreground">
            {growth?.summary?.growthRate ?? "0"}%
          </p>
        </div>
      </div>
    </div>
  );
}
