// Web port of SupremeCourtCaseCard in webapp/mobile/src/app/(tabs)/discover.tsx
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import { supremeCourtCases } from "@/lib/mobile/government-data";
import { cn } from "@/lib/utils";

const statusColors: Record<string, { bg: string; text: string }> = {
  decided: { bg: "bg-emerald-900/50", text: "text-emerald-400" },
  argued: { bg: "bg-blue-900/50", text: "text-blue-400" },
  pending: { bg: "bg-amber-900/50", text: "text-amber-400" },
};

export function SupremeCourtCaseCard({
  scotusCase,
  index,
}: {
  scotusCase: (typeof supremeCourtCases)[0];
  index: number;
}) {
  const navigate = useNavigate();
  const categoryColor = categoryColors[scotusCase.category] ?? "#64748B";

  const status = statusColors[scotusCase.status] || statusColors.pending;
  const totalVotes = scotusCase.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((scotusCase.communityVotes.yea / totalVotes) * 100);

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 260, damping: 24 }}
      className="mb-3"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/scotus/${scotusCase.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") navigate(`/scotus/${scotusCase.id}`);
        }}
        className="cursor-pointer rounded-xl border border-purple-700/30 bg-card/60 p-4 transition-colors hover:bg-card"
      >
        <div className="mb-2 flex items-start justify-between">
          <div className="flex flex-1 flex-wrap items-center">
            <span className="mb-1 mr-2 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-semibold text-purple-400">
              {scotusCase.docketNumber}
            </span>
            <span
              className="mb-1 mr-2 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
            >
              {categoryLabels[scotusCase.category]}
            </span>
            <span className={cn("mb-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize", status.bg, status.text)}>
              {scotusCase.status}
            </span>
            {scotusCase.voteBreakdown ? (
              <span className="mb-1 ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-foreground">
                {scotusCase.voteBreakdown.majority}-{scotusCase.voteBreakdown.dissent}
              </span>
            ) : null}
          </div>
        </div>

        <p className="mb-1 text-base font-semibold text-foreground">{scotusCase.shortName}</p>
        <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
          {scotusCase.simplifiedQuestion}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-sm text-muted-foreground/70">{scotusCase.term} Term</span>
            {scotusCase.outcome ? (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-foreground/80">
                {scotusCase.outcome}
              </span>
            ) : null}
          </div>
          <div className="flex items-center">
            <span className="mr-1 text-sm text-purple-400">{yeaPercentage}% agree</span>
            <ChevronRight size={18} color="#64748B" />
          </div>
        </div>
      </div>
    </MotionDiv>
  );
}
