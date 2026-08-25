// Web port of webapp/mobile/src/app/b2b/dashboard.tsx — B2B analytics overview.
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Map,
  TrendingUp,
  TrendingDown,
  Users,
  FileText,
  MessageSquare,
  Vote,
  ChevronRight,
  Activity,
  Target,
  Zap,
  Building2,
} from "lucide-react";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

function MetricCard({
  title,
  value,
  change,
  icon,
  color,
}: {
  title: string;
  value: string | number;
  change?: number;
  icon: ReactNode;
  color: string;
}) {
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${color}20` }}
        >
          {icon}
        </div>
        {change !== undefined ? (
          <div
            className={cn(
              "flex items-center rounded-full px-2 py-1",
              isPositive ? "bg-emerald-500/20" : isNegative ? "bg-red-500/20" : "bg-slate-700/50",
            )}
          >
            {isPositive ? (
              <TrendingUp size={12} color="#34D399" />
            ) : isNegative ? (
              <TrendingDown size={12} color="#EF4444" />
            ) : null}
            <span
              className={cn(
                "ml-1 text-xs font-medium",
                isPositive ? "text-emerald-400" : isNegative ? "text-red-400" : "text-slate-400",
              )}
            >
              {isPositive ? "+" : ""}
              {change}%
            </span>
          </div>
        ) : null}
      </div>
      <span className="block text-2xl font-bold text-white">{value}</span>
      <span className="mt-1 block text-sm text-slate-400">{title}</span>
    </div>
  );
}

function SentimentBar({
  label,
  support,
  oppose,
}: {
  label: string;
  support: number;
  oppose: number;
}) {
  const total = support + oppose;
  const supportPercent = total > 0 ? (support / total) * 100 : 50;

  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between">
        <span className="text-sm font-medium text-slate-300">{label}</span>
        <span className="text-xs text-slate-400">
          {support.toLocaleString()} vs {oppose.toLocaleString()}
        </span>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-700">
        <div className="h-full rounded-l-full bg-emerald-500" style={{ width: `${supportPercent}%` }} />
        <div className="h-full rounded-r-full bg-red-500" style={{ width: `${100 - supportPercent}%` }} />
      </div>
    </div>
  );
}

function QuickLink({
  title,
  subtitle,
  icon,
  to,
  gradient,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  to: string;
  gradient: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "mb-3 block rounded-2xl bg-gradient-to-br p-4 transition-transform hover:scale-[1.01]",
        gradient,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-1 items-center">
          <div className="mr-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
            {icon}
          </div>
          <div className="flex-1">
            <span className="block text-base font-semibold text-white">{title}</span>
            <span className="block text-sm text-white/70">{subtitle}</span>
          </div>
        </div>
        <ChevronRight size={20} color="white" />
      </div>
    </Link>
  );
}

export default function B2BDashboard() {
  const sentimentOverview = useB2BStore((s) => s.sentimentOverview);
  const trendingTopics = useB2BStore((s) => s.trendingTopics);
  const fetchSentimentOverview = useB2BStore((s) => s.fetchSentimentOverview);
  const fetchTrendingTopics = useB2BStore((s) => s.fetchTrendingTopics);
  const isAuthenticated = useB2BStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSentimentOverview();
    fetchTrendingTopics();
  }, [isAuthenticated, fetchSentimentOverview, fetchTrendingTopics]);

  const overallScore = sentimentOverview?.overall?.score ?? 0;

  return (
    <B2BShell>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Overall Sentiment */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-lg font-bold text-white">Platform Sentiment</span>
            <div
              className={cn(
                "flex items-center rounded-full px-3 py-1",
                overallScore > 0 ? "bg-emerald-500/20" : "bg-red-500/20",
              )}
            >
              {overallScore > 0 ? (
                <TrendingUp size={14} color="#34D399" />
              ) : (
                <TrendingDown size={14} color="#EF4444" />
              )}
              <span
                className={cn(
                  "ml-1 font-medium",
                  overallScore > 0 ? "text-emerald-400" : "text-red-400",
                )}
              >
                {(overallScore * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <SentimentBar
            label="Legislative"
            support={sentimentOverview?.byBranch?.legislative?.support ?? 0}
            oppose={sentimentOverview?.byBranch?.legislative?.oppose ?? 0}
          />
          <SentimentBar
            label="Executive"
            support={sentimentOverview?.byBranch?.executive?.support ?? 0}
            oppose={sentimentOverview?.byBranch?.executive?.oppose ?? 0}
          />
          <SentimentBar
            label="Judicial"
            support={sentimentOverview?.byBranch?.judicial?.support ?? 0}
            oppose={sentimentOverview?.byBranch?.judicial?.oppose ?? 0}
          />
        </div>

        {/* Trending Topics */}
        <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
          <span className="mb-3 block text-lg font-bold text-white">Trending Topics</span>
          {trendingTopics.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No trending data yet</p>
          ) : (
            trendingTopics.slice(0, 5).map((topic, index) => (
              <div
                key={topic.id || index}
                className={cn(
                  "flex items-center justify-between py-3",
                  index < Math.min(4, trendingTopics.length - 1)
                    ? "border-b border-slate-700/50"
                    : "",
                )}
              >
                <div className="flex flex-1 items-center">
                  <div
                    className={cn(
                      "mr-3 flex h-8 w-8 items-center justify-center rounded-lg",
                      (topic.sentiment ?? 0) > 0 ? "bg-emerald-500/20" : "bg-red-500/20",
                    )}
                  >
                    <span
                      className={cn(
                        "font-bold",
                        (topic.sentiment ?? 0) > 0 ? "text-emerald-400" : "text-red-400",
                      )}
                    >
                      #{index + 1}
                    </span>
                  </div>
                  <div className="flex-1">
                    <span className="block font-medium text-white">
                      {topic.topic || "Unknown"}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {(topic.mentions ?? 0).toLocaleString()} mentions
                    </span>
                  </div>
                </div>
                <div className="flex items-center">
                  {topic.velocity === "accelerating" ? (
                    <Zap size={14} color="#FBBF24" />
                  ) : (topic.change24h ?? 0) > 0 ? (
                    <TrendingUp size={14} color="#34D399" />
                  ) : (
                    <TrendingDown size={14} color="#EF4444" />
                  )}
                  <span
                    className={cn(
                      "ml-1 text-sm",
                      (topic.change24h ?? 0) > 0 ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {(topic.change24h ?? 0) > 0 ? "+" : ""}
                    {topic.change24h ?? 0}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Engagement Metrics */}
      <span className="mb-3 mt-6 block text-lg font-bold text-white">Engagement Metrics</span>
      {/*
        NO `change` ON ANY OF THESE. They used to carry change={12}, change={8},
        change={15} and change={-3} — four literals, drawn as green and red
        arrows, that had never been computed from anything and never moved. A
        made-up trend arrow on a dashboard somebody is paying for is worse than
        no arrow: it is a claim. The one change figure that is measured is the
        weekly one below, and MetricCard already renders nothing when `change`
        is absent.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          title="Total Votes"
          value={(sentimentOverview?.engagement?.totalVotes ?? 0).toLocaleString()}
          change={sentimentOverview?.overall?.changePercent ?? undefined}
          icon={<Vote size={20} color="#818CF8" />}
          color="#818CF8"
        />
        <MetricCard
          title="Participants"
          value={(sentimentOverview?.engagement?.participants ?? 0).toLocaleString()}
          icon={<Users size={20} color="#34D399" />}
          color="#34D399"
        />
        <MetricCard
          title="Posts"
          value={(sentimentOverview?.engagement?.totalPosts ?? 0).toLocaleString()}
          icon={<FileText size={20} color="#FBBF24" />}
          color="#FBBF24"
        />
        <MetricCard
          title="Comments"
          value={(sentimentOverview?.engagement?.totalComments ?? 0).toLocaleString()}
          icon={<MessageSquare size={20} color="#F472B6" />}
          color="#F472B6"
        />
      </div>

      {/* Quick Links */}
      <span className="mb-3 mt-6 block text-lg font-bold text-white">Analytics</span>
      <div className="grid gap-x-4 md:grid-cols-2">
        <QuickLink
          title="District Heatmap"
          subtitle="Geographic sentiment visualization"
          icon={<Map size={24} color="white" />}
          to="/b2b/heatmap"
          gradient="from-[#4338CA] to-[#6366F1]"
        />
        <QuickLink
          title="Issue Tracker"
          subtitle="Track sentiment by policy area"
          icon={<Target size={24} color="white" />}
          to="/b2b/issues"
          gradient="from-[#059669] to-[#10B981]"
        />
        <QuickLink
          title="State Analysis"
          subtitle="State-by-state breakdown"
          icon={<Building2 size={24} color="white" />}
          to="/b2b/states"
          gradient="from-[#D97706] to-[#F59E0B]"
        />
        <QuickLink
          title="Forecasting"
          subtitle="Predictive sentiment analysis"
          icon={<Activity size={24} color="white" />}
          to="/b2b/forecast"
          gradient="from-[#DC2626] to-[#EF4444]"
        />
        <QuickLink
          title="Reports"
          subtitle="Generate custom reports"
          icon={<FileText size={24} color="white" />}
          to="/b2b/reports"
          gradient="from-[#7C3AED] to-[#8B5CF6]"
        />
      </div>
    </B2BShell>
  );
}
