import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * The inbox for what people report from the app.
 *
 * Open first and newest first, because a report nobody has looked at is the
 * only kind costing anything. Every state change records who made it — a queue
 * that changes anonymously is a queue nobody trusts.
 */

interface BugReport {
  id: string;
  username: string | null;
  pageUrl: string;
  pagePath: string;
  elementLabel: string | null;
  elementPath: string | null;
  problem: string;
  wanted: string | null;
  userAgent: string | null;
  viewport: string | null;
  appCommit: string | null;
  status: string;
  adminNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

const FILTERS = ["open", "acknowledged", "fixed", "declined", "all"] as const;

export function BugReportsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "bug-reports", filter],
    queryFn: () =>
      api.get<{ reports: BugReport[]; total: number; openCount: number }>(
        `/api/admin/bug-reports?status=${filter}`,
        { headers: adminAuthHeader() },
      ),
  });

  const triage = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/api/admin/bug-reports/${id}`, { status }, { headers: adminAuthHeader() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "bug-reports"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update that report"),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Bug className="h-4 w-4 text-amber-500" />
        <span className="font-semibold text-foreground">Bug reports</span>
        {data?.openCount ? (
          <Badge variant="secondary">{data.openCount} open</Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1">
          {FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
              className="capitalize"
            >
              {value}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.reports.length ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {filter === "open" ? "Nothing open. " : "Nothing here. "}
          Reports arrive from the bug button on every page.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.reports.map((report) => (
            <li key={report.id} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={report.status === "open" ? "default" : "secondary"}>
                  {report.status}
                </Badge>
                <span>{new Date(report.createdAt).toLocaleString()}</span>
                <span>·</span>
                <span>{report.username ? `@${report.username}` : "signed out"}</span>
                <a
                  href={report.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-amber-500 hover:underline"
                >
                  {report.pagePath}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {report.elementLabel ? (
                <p className="mb-2 text-sm">
                  <span className="text-muted-foreground">Pointed at </span>
                  <span className="font-medium text-foreground">“{report.elementLabel}”</span>
                </p>
              ) : null}

              <p className="text-sm text-foreground">{report.problem}</p>
              {report.wanted ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Wanted: </span>
                  {report.wanted}
                </p>
              ) : null}

              {/* The three things that decide whether this is reproducible. */}
              <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                {[report.viewport, report.appCommit?.slice(0, 7), report.elementPath]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              {report.resolvedBy ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Closed by {report.resolvedBy}
                </p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={triage.isPending}
                    onClick={() => triage.mutate({ id: report.id, status: "acknowledged" })}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={triage.isPending}
                    onClick={() => triage.mutate({ id: report.id, status: "fixed" })}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Fixed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={triage.isPending}
                    onClick={() => triage.mutate({ id: report.id, status: "declined" })}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
