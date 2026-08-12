// Web port of TrendingBillCard in webapp/mobile/src/app/(tabs)/discover.tsx
import { useNavigate } from "react-router-dom";
import { Flame, ThumbsUp, Users } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { useVotingStore, selectUserVote } from "@/lib/mobile/voting-store";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import type { Bill } from "@/lib/mobile/types";
import { cn } from "@/lib/utils";

export function TrendingBillCard({ bill, index }: { bill: Bill; index: number }) {
  const navigate = useNavigate();
  const userVote = useVotingStore(selectUserVote(bill.id));
  const categoryColor = categoryColors[bill.category] ?? "#64748B";

  const totalVotes = bill.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((bill.communityVotes.yea / totalVotes) * 100);

  return (
    <MotionDiv
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.08, type: "spring", stiffness: 260, damping: 24 }}
      className="shrink-0"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/bill/${bill.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") navigate(`/bill/${bill.id}`);
        }}
        className="mr-3 w-[280px] cursor-pointer rounded-xl border border-border/50 bg-card/70 p-4 transition-colors hover:bg-card"
      >
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center">
            <span className="mr-2 rounded-full bg-amber-500/20 p-1.5">
              <Flame size={14} color="#F59E0B" />
            </span>
            <span className="text-xs font-semibold text-amber-500">
              #{index + 1} Trending
            </span>
          </div>
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
          >
            {categoryLabels[bill.category]}
          </span>
        </div>

        <p className="mb-1 line-clamp-2 text-base font-semibold text-foreground">
          {bill.shortTitle}
        </p>
        <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{bill.title}</p>

        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="mr-3 flex items-center">
              <ThumbsUp size={12} color="#22C55E" />
              <span className="ml-1 text-xs text-emerald-500">{yeaPercentage}%</span>
            </span>
            <span className="flex items-center">
              <Users size={12} color="#64748B" />
              <span className="ml-1 text-xs text-muted-foreground">
                {bill.communityVotes.totalVoters.toLocaleString()}
              </span>
            </span>
          </div>
          {userVote ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                userVote === "yea"
                  ? "bg-emerald-900/60 text-emerald-400"
                  : "bg-red-900/60 text-red-400",
              )}
            >
              You voted {userVote}
            </span>
          ) : null}
        </div>
      </div>
    </MotionDiv>
  );
}
