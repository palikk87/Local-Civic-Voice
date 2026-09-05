import { ExternalLink, ChevronRight, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/civic";
import type {
  CongressResult,
  ExecutiveResult,
  JudicialResult,
  LibraryBranch,
  LibraryRow,
} from "@/lib/library";
import type { LegislativeStatus } from "@/lib/mobile/government-api";
import { BRANCH_TABS } from "./BranchTabs";
import { cn } from "@/lib/utils";

function branchColor(branch: LibraryBranch): string {
  return BRANCH_TABS.find((t) => t.key === branch)?.color ?? "hsl(var(--accent))";
}

function TypeBadge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

// Status label palette mirrors statusLabelColors in mobile library.tsx
const STATUS_LABELS: Record<LegislativeStatus, { color: string; label: string }> = {
  active: { color: "#22C55E", label: "Active" },
  proposed: { color: "#3B82F6", label: "Proposed" },
  repealed: { color: "#EF4444", label: "Repealed" },
  landmark: { color: "#F59E0B", label: "Landmark" },
  pending: { color: "#8B5CF6", label: "Pending" },
};

function StatusLabelBadge({ status }: { status: LegislativeStatus }) {
  const meta = STATUS_LABELS[status] ?? STATUS_LABELS.proposed;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{
        color: meta.color,
        backgroundColor: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
      }}
    >
      {meta.label}
    </span>
  );
}

/**
 * Result card. Clicking the card opens the Citizen's Brief preview (the mobile
 * library screen's behaviour); the external-link icon still goes to the
 * official source.
 */
function CardShell({
  sourceUrl,
  color,
  onOpen,
  children,
}: {
  sourceUrl: string;
  color: string;
  onOpen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group block cursor-pointer rounded-2xl border border-border bg-card p-4 transition-colors hover:border-accent/40"
      style={{ borderLeft: `3px solid color-mix(in srgb, ${color} 55%, transparent)` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label="Open official source"
          className="mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-accent"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          Official Source
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-accent">
          Citizen's Brief
          <ChevronRight className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function CongressCard({
  item,
  statusLabel,
  onOpen,
}: {
  item: CongressResult;
  statusLabel: LegislativeStatus;
  onOpen: () => void;
}) {
  const color = branchColor("congress");

  return (
    <CardShell sourceUrl={item.url} color={color} onOpen={onOpen}>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge color={color}>
          {item.type} {item.number}
        </TypeBadge>
        <StatusLabelBadge status={statusLabel} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          {item.masterReferenceId}
        </span>
      </div>
      <h3 className="text-sm font-semibold leading-snug text-foreground">{item.title}</h3>
      {item.latestAction ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {shortDate(item.latestAction.actionDate)}
          </span>{" "}
          — {item.latestAction.text}
        </p>
      ) : null}
    </CardShell>
  );
}

function ExecutiveCard({ item, onOpen }: { item: ExecutiveResult; onOpen: () => void }) {
  const color = branchColor("executive");
  const agency = item.agencies?.[0]?.name;
  /*
   * An order signed in the last few days. The Federal Register has not
   * published it yet — so it has no order number, no publication date and no
   * page on their site, and every one of those is shown as absent rather than
   * filled in with something that looks right.
   */
  const justSigned = item.just_signed === true;
  const shownDate = item.publication_date || item.signing_date;
  return (
    <CardShell sourceUrl={item.html_url} color={color} onOpen={onOpen}>
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge color={color}>{item.type}</TypeBadge>
        <StatusLabelBadge
          status={item.type === "Presidential Document" ? "active" : "proposed"}
        />
        {justSigned ? (
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
            Just signed
          </span>
        ) : null}
      </div>
      <h3 className="text-sm font-semibold leading-snug text-foreground">{item.title}</h3>
      <p className="text-xs text-muted-foreground">
        {agency ? <span className="text-foreground/80">{agency}</span> : null}
        {agency && shownDate ? " · " : null}
        {shownDate ? shortDate(shownDate) : null}
      </p>
      {justSigned ? (
        <p className="text-xs text-amber-200/80">
          Signed and published by the White House. The Federal Register usually
          takes a few more days to assign its order number.
        </p>
      ) : null}
      {item.abstract ? (
        <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {item.abstract}
        </p>
      ) : null}
    </CardShell>
  );
}

function JudicialCard({ item, onOpen }: { item: JudicialResult; onOpen: () => void }) {
  const color = branchColor("judicial");
  return (
    <CardShell
      sourceUrl={`https://www.courtlistener.com${item.absolute_url}`}
      color={color}
      onOpen={onOpen}
    >
      <div className="flex flex-wrap items-center gap-2">
        {item.docket_number ? <TypeBadge color={color}>{item.docket_number}</TypeBadge> : null}
        <StatusLabelBadge status="landmark" />
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {shortDate(item.date_filed)}
        </span>
      </div>
      <h3 className="text-sm font-semibold leading-snug text-foreground">{item.case_name}</h3>
      <p className="text-xs text-muted-foreground">{item.court}</p>
    </CardShell>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border py-16 text-center">
      <p className="font-display text-lg text-foreground">{message}</p>
      <p className="mt-1 text-sm text-muted-foreground">Try another search term.</p>
    </div>
  );
}

interface LibraryResultsProps {
  /** One list, in the order the page wants them read, each row saying where it came from. */
  rows: LibraryRow[];
  isLoading: boolean;
  isError: boolean;
  onOpenCongress: (item: CongressResult) => void;
  onOpenExecutive: (item: ExecutiveResult) => void;
  onOpenJudicial: (item: JudicialResult) => void;
  statusLabelFor: (item: CongressResult) => LegislativeStatus;
  className?: string;
}

export function LibraryResults({
  rows,
  isLoading,
  isError,
  onOpenCongress,
  onOpenExecutive,
  onOpenJudicial,
  statusLabelFor,
  className,
}: LibraryResultsProps) {
  if (isLoading) return <ResultsSkeleton />;

  if (isError) {
    return <EmptyState message="Something went wrong" />;
  }

  if (rows.length === 0) return <EmptyState message="No results" />;

  return (
    <div className={cn("space-y-3", className)}>
      {rows.map((row) => {
        switch (row.branch) {
          case "congress":
            return (
              <CongressCard
                key={`congress-${row.item.congress}-${row.item.type}-${row.item.number}`}
                item={row.item}
                statusLabel={statusLabelFor(row.item)}
                onOpen={() => onOpenCongress(row.item)}
              />
            );
          case "executive":
            return (
              <ExecutiveCard
                key={`executive-${row.item.document_number}`}
                item={row.item}
                onOpen={() => onOpenExecutive(row.item)}
              />
            );
          case "judicial":
            return (
              <JudicialCard
                key={`judicial-${row.item.id}`}
                item={row.item}
                onOpen={() => onOpenJudicial(row.item)}
              />
            );
        }
      })}
    </div>
  );
}
