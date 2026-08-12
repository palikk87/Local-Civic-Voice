// Web port of OfficeHolderCard + GovernmentBranchSection in
// webapp/mobile/src/app/(tabs)/discover.tsx — fed by the live
// GET /api/government/officials data (same source as the Government tab).
import { FileText, Landmark, Scale, ChevronDown, ChevronUp } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { Official, Department } from "@/lib/government-service";
import type { GovernmentBranch } from "@/lib/mobile/types";
import { officialPhoto } from "./GovernmentOverview";
import { cn } from "@/lib/utils";

const partyColors: Record<string, { bg: string; text: string }> = {
  D: { bg: "bg-blue-900/50", text: "text-blue-400" },
  R: { bg: "bg-red-900/50", text: "text-red-400" },
  I: { bg: "bg-purple-900/50", text: "text-purple-400" },
  none: { bg: "bg-muted", text: "text-foreground/70" },
};

export function OfficeHolderCard({ holder, index }: { holder: Official; index: number }) {
  const party = partyColors[holder.party ?? "none"];

  return (
    <MotionDiv
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 260, damping: 24 }}
      className="shrink-0"
    >
      <div className="mr-3 w-[160px] rounded-xl border border-border/50 bg-card/70 p-3">
        <img
          src={officialPhoto(holder)}
          alt={holder.name}
          className="mb-2 h-24 w-full rounded-lg bg-muted object-cover"
        />
        <p className="truncate text-sm font-semibold text-foreground">{holder.name}</p>
        <p className="mb-1 line-clamp-2 text-xs text-muted-foreground">
          {holder.shortTitle || holder.title}
        </p>
        <div className="flex items-center">
          {holder.party ? (
            <span
              className={cn(
                "mr-1 rounded-full px-1.5 py-0.5 text-xs font-medium",
                party.bg,
                party.text,
              )}
            >
              {holder.party}
            </span>
          ) : null}
          {holder.acting ? (
            <span className="text-xs text-muted-foreground/70">Acting</span>
          ) : null}
        </div>
      </div>
    </MotionDiv>
  );
}

const branchConfig: Record<
  GovernmentBranch,
  { color: string; icon: React.ReactNode; label: string }
> = {
  executive: { color: "#F59E0B", icon: <FileText size={20} color="#F59E0B" />, label: "Executive Branch" },
  legislative: { color: "#3B82F6", icon: <Landmark size={20} color="#3B82F6" />, label: "Legislative Branch" },
  judicial: { color: "#8B5CF6", icon: <Scale size={20} color="#8B5CF6" />, label: "Judicial Branch" },
};

export function GovernmentBranchSection({
  branch,
  holders,
  departments,
  expanded,
  onToggle,
}: {
  branch: GovernmentBranch;
  holders: Official[];
  departments: Department[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = branchConfig[branch];

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="mb-4"
    >
      <div
        className="rounded-xl border bg-card/60 p-4"
        style={{ borderColor: `${config.color}40` }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center">
            <span className="mr-3 rounded-full p-2" style={{ backgroundColor: `${config.color}20` }}>
              {config.icon}
            </span>
            <span>
              <span className="block text-lg font-semibold text-foreground">{config.label}</span>
              <span className="block text-sm text-muted-foreground">
                {holders.length} officials
                {departments.length > 0 ? ` · ${departments.length} departments` : ""}
              </span>
            </span>
          </div>
          {expanded ? (
            <ChevronUp size={20} color="#64748B" />
          ) : (
            <ChevronDown size={20} color="#64748B" />
          )}
        </button>

        {expanded ? (
          <div className="mt-4 border-t border-border/50 pt-4">
            {/* Key Officials */}
            <p className="mb-3 font-medium text-foreground">Key Officials</p>
            <div className="flex overflow-x-auto pb-1">
              {holders.slice(0, 6).map((holder, index) => (
                <OfficeHolderCard key={holder.id} holder={holder} index={index} />
              ))}
            </div>

            {/* Departments */}
            {departments.length > 0 ? (
              <>
                <p className="mb-2 mt-4 font-medium text-foreground">Departments</p>
                <div className="flex flex-wrap">
                  {departments.map((dept) => (
                    <span
                      key={dept.id}
                      className="mb-2 mr-2 rounded-full bg-muted/50 px-3 py-1.5 text-xs text-foreground/80"
                    >
                      {dept.abbreviation}
                    </span>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </MotionDiv>
  );
}
