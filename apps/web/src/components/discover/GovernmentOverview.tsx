// Web port of PresidentialSuccessionSection, SupremeCourtJusticesSection and
// DataFreshnessIndicator in webapp/mobile/src/app/(tabs)/discover.tsx.
// Fed by GET /api/government/officials — the same live source as the Government
// tab — via props from the Discover page (no more static snapshot data).
import { Crown, Gavel, RefreshCw } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { Official } from "@/lib/government-service";
import { cn } from "@/lib/utils";

export function officialPhoto(official: Official): string {
  return (
    official.photoUrl ??
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(official.name)}`
  );
}

export function PresidentialSuccessionSection({ succession }: { succession: Official[] }) {
  return (
    <MotionDiv
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="mb-4"
    >
      <div className="rounded-xl border border-amber-700/30 bg-card/60 p-4">
        <div className="mb-3 flex items-center">
          <Crown size={18} color="#F59E0B" />
          <span className="ml-2 text-lg font-semibold text-foreground">
            Presidential Succession
          </span>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Order of succession to the Presidency
        </p>

        {succession.slice(0, 10).map((holder, index) => (
          <div
            key={holder.id}
            className="flex items-center border-b border-border/30 py-2 last:border-b-0"
          >
            <span className="mr-3 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20">
              <span className="text-xs font-bold text-amber-500">
                {holder.successionOrder ?? index + 1}
              </span>
            </span>
            <img
              src={officialPhoto(holder)}
              alt={holder.name}
              className="mr-3 h-8 w-8 rounded-full bg-muted object-cover"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{holder.name}</span>
              <span className="block text-xs text-muted-foreground">{holder.title}</span>
            </span>
            {holder.party ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  holder.party === "R"
                    ? "bg-red-900/50 text-red-400"
                    : holder.party === "D"
                      ? "bg-blue-900/50 text-blue-400"
                      : "bg-purple-900/50 text-purple-400",
                )}
              >
                {holder.party}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </MotionDiv>
  );
}

export function SupremeCourtJusticesSection({ justices }: { justices: Official[] }) {
  return (
    <MotionDiv
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 260, damping: 24 }}
      className="mb-4"
    >
      <div className="rounded-xl border border-purple-700/30 bg-card/60 p-4">
        <div className="mb-3 flex items-center">
          <Gavel size={18} color="#8B5CF6" />
          <span className="ml-2 text-lg font-semibold text-foreground">
            Supreme Court Justices
          </span>
        </div>

        <div className="flex flex-wrap">
          {justices.map((justice) => {
            const isChief = /chief justice/i.test(justice.title);

            return (
              <div key={justice.id} className="w-1/3 p-1">
                <div className="flex flex-col items-center rounded-lg bg-muted/50 p-2">
                  <img
                    src={officialPhoto(justice)}
                    alt={justice.name}
                    className="mb-1 h-12 w-12 rounded-full bg-muted object-cover"
                  />
                  <span className="w-full truncate text-center text-xs font-medium text-foreground">
                    {justice.name.split(" ").pop()}
                  </span>
                  {isChief ? (
                    <span className="mt-1 rounded-full bg-purple-500/30 px-1.5 py-0.5 text-[10px] text-purple-400">
                      Chief
                    </span>
                  ) : null}
                  <span className="mt-0.5 text-[10px] text-muted-foreground/70">
                    {justice.appointedBy ? `${justice.appointedBy.split(" ").pop()} ` : ""}
                    {justice.since ? `'${justice.since.slice(2, 4)}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </MotionDiv>
  );
}

export function DataFreshnessIndicator({ lastUpdated }: { lastUpdated: string | null }) {
  const lastUpdate = lastUpdated ? new Date(lastUpdated) : null;
  // Live endpoint data is considered stale after 90 days without a refresh
  const isStale = lastUpdate
    ? Date.now() - lastUpdate.getTime() > 90 * 24 * 60 * 60 * 1000
    : true;

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-card/40 px-4 py-2">
      <div className="flex items-center">
        <RefreshCw size={14} color={isStale ? "#F59E0B" : "#22C55E"} />
        <span className="ml-2 text-xs text-muted-foreground">
          Last updated: {lastUpdate ? lastUpdate.toLocaleDateString() : "—"}
        </span>
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-medium",
          isStale ? "bg-amber-900/50 text-amber-400" : "bg-emerald-900/50 text-emerald-400",
        )}
      >
        {isStale ? "Update available" : "Current"}
      </span>
    </div>
  );
}
