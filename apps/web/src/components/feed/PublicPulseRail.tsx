import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, ScrollText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { civicApi, branchOf, supportPct, type GovReference } from "@/lib/civic";

function PulseRow({ reference }: { reference: GovReference }) {
  const pct = supportPct(reference.votes);
  const branch = branchOf(reference.referenceType);
  return (
    <Link
      to={`/reference/${reference.id}`}
      className="block rounded-xl px-3 py-2.5 transition-colors hover:bg-secondary/60"
    >
      <p className="truncate text-sm font-medium text-foreground">
        {reference.shortTitle || reference.title}
      </p>
      <p className="mt-0.5 text-xs" style={{ color: branch.colorVar }}>
        {branch.label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-oppose">
          <div className="h-full bg-support" style={{ width: `${pct}%` }} />
        </div>
        <span className="w-9 shrink-0 text-right font-mono text-[11px] text-support">
          {pct}%
        </span>
      </div>
    </Link>
  );
}

export function PublicPulseRail() {
  const { data, isLoading } = useQuery({
    queryKey: ["trending-references", 6],
    queryFn: () => civicApi.trending(6),
  });

  const references = data?.references ?? [];

  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="px-3 font-display text-base font-semibold text-foreground">
          Public Pulse
        </h2>
        <div className="mt-2 space-y-0.5">
          {isLoading ? (
            <div className="space-y-2 px-3 py-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            references.map((r) => <PulseRow key={r.id} reference={r} />)
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 px-1">
          <BookOpen className="h-4 w-4 text-accent" />
          <h2 className="font-display text-base font-semibold text-foreground">
            Founding Documents
          </h2>
        </div>
        <div className="mt-3 space-y-1">
          <Link
            to="/documents#constitution"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <BookOpen className="h-4 w-4" /> The Constitution
          </Link>
          <Link
            to="/documents#bill-of-rights"
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            <ScrollText className="h-4 w-4" /> The Bill of Rights
          </Link>
        </div>
      </section>
    </>
  );
}
