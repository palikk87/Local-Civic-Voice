// Web port of ExecutiveOrderCard in webapp/mobile/src/app/(tabs)/discover.tsx
import { useNavigate } from "react-router-dom";
import { ThumbsUp, ChevronRight } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { ShareToTimeline } from "@/components/civic/ShareToTimeline";
import { categoryColors, categoryLabels } from "@/lib/mobile/mock-data";
import type { ExecutiveOrder } from "@/lib/mobile/types";
import { cn } from "@/lib/utils";

const statusColors: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-emerald-900/50", text: "text-emerald-400" },
  revoked: { bg: "bg-red-900/50", text: "text-red-400" },
  superseded: { bg: "bg-amber-900/50", text: "text-amber-400" },
};

export function ExecutiveOrderCard({
  eo,
  index,
}: {
  eo: ExecutiveOrder;
  index: number;
}) {
  const navigate = useNavigate();
  const categoryColor = categoryColors[eo.category] ?? "#64748B";

  const status = statusColors[eo.status] || statusColors.active;
  const totalVotes = eo.communityVotes.totalVoters || 1;
  const yeaPercentage = Math.round((eo.communityVotes.yea / totalVotes) * 100);

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
        onClick={() => navigate(`/reference/${eo.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") navigate(`/reference/${eo.id}`);
        }}
        className="cursor-pointer rounded-xl border border-amber-700/30 bg-card/60 p-4 transition-colors hover:bg-card"
      >
        <div className="mb-2 flex items-start justify-between">
          <div className="flex flex-1 flex-wrap items-center">
            <span className="mb-1 mr-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-500">
              {eo.eoNumber}
            </span>
            <span
              className="mb-1 mr-2 rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: `${categoryColor}30`, color: categoryColor }}
            >
              {categoryLabels[eo.category]}
            </span>
            <span className={cn("mb-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize", status.bg, status.text)}>
              {eo.status}
            </span>
          </div>
        </div>

        <p className="mb-1 text-base font-semibold text-foreground">{eo.shortTitle}</p>
        <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
          Signed by {eo.president} on {new Date(eo.signedDate).toLocaleDateString()}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <ThumbsUp size={14} color="#22C55E" />
            <span className="ml-1 text-sm font-medium text-emerald-500">{yeaPercentage}%</span>
            <span className="ml-2 text-sm text-muted-foreground/70">
              ({eo.communityVotes.totalVoters.toLocaleString()} votes)
            </span>
          </div>
          <div className="flex items-center gap-1">
            <ShareToTimeline
              target={{
                branch: "executive",
                title: eo.title,
                ...(eo.eoNumber ? { eoNumber: eo.eoNumber } : {}),
              }}
              label=""
            />
            <ChevronRight size={18} color="#64748B" />
          </div>
        </div>
      </div>
    </MotionDiv>
  );
}
