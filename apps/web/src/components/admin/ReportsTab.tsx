import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, Gavel, Loader2, ShieldBan, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * What people report about each other, and what became of it.
 *
 * THE QUEUE WAS BUILT AND NEVER GIVEN A DOOR. `GET /api/admin/reports` and
 * `POST /api/admin/reports/:id` have existed for months and no screen in either
 * app has ever called them. So somebody filed a report, was told it had been
 * sent, went looking for it as an administrator and found nothing — because
 * there was nothing to look at, not because nothing had been recorded.
 *
 * WHAT AN ADMINISTRATOR MAY DO HERE, and what they may not:
 *
 *   - See every report, and the true state of the jury drawn for it.
 *   - Ban an account, for the safety of the people on this platform now.
 *   - Mark a report handled or dismissed, which closes THE REPORT.
 *
 * Closing a report DOES NOT TOUCH THE JURY. Article IV §3 gives disputes of
 * conduct to a jury of citizens, and Article V §3 says no Officer may halt a
 * proceeding. Two different questions — "is anybody in danger right now" and
 * "did this person break the rules" — answered by two different bodies, neither
 * cancelling the other. The page says so where somebody is about to click.
 */

interface ReportedPerson {
  id: string;
  name: string | null;
  username: string | null;
  banned?: boolean;
}

interface ReportRow {
  id: string;
  reason: string;
  detail: string | null;
  status: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reporter: ReportedPerson;
  reportedUser: ReportedPerson | null;
  post: { id: string; content?: string; deleted?: boolean; author?: ReportedPerson } | null;
  comment: { id: string; content?: string; deleted?: boolean; author?: ReportedPerson } | null;
  /** Null when no jury was ever drawn. */
  jury: {
    id: string;
    status: string;
    seats: number;
    panelKind: string;
    verdict: string | null;
    filled: number;
    voted: number;
  } | null;
}

const FILTERS = ["open", "actioned", "dismissed", "all"] as const;

/** The six reasons, in the words the reporter picked them by. */
const REASON_LABELS: Record<string, string> = {
  harassment: "Harassment",
  hate: "Hate",
  violence: "Violence or threats",
  misinformation: "Misrepresenting a law",
  spam: "Spam",
  other: "Something else",
};

function handle(person: ReportedPerson | null | undefined): string {
  if (!person) return "someone";
  return person.username ? `@${person.username}` : person.name ?? "someone";
}

/**
 * The jury, counted rather than assumed.
 *
 * THIS IS THE LINE THAT WAS MISSING. A report empanels a jury the moment it is
 * filed, and on a young platform that draw can seat nobody. Without this, a
 * case waiting on seven jurors and a case waiting on nobody looked identical —
 * which is exactly how a report could be filed, recorded, and then never heard
 * by anyone, with nothing anywhere saying so.
 */
function JuryState({ jury }: { jury: ReportRow["jury"] }) {
  if (!jury) {
    return (
      <p className="mt-2 text-xs text-amber-500">
        No jury was drawn for this. Nobody is hearing it.
      </p>
    );
  }

  if (jury.status === "decided") {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Gavel className="h-3.5 w-3.5" />
        A jury {jury.verdict === "upheld" ? "upheld" : "dismissed"} this.{" "}
        <a href={`/jury/${jury.id}`} className="underline underline-offset-2">
          Read their reasons
        </a>
      </p>
    );
  }

  const empty = jury.filled === 0;
  return (
    <p
      data-testid="jury-state"
      className={`mt-2 flex items-center gap-1.5 text-xs ${empty ? "text-amber-500" : "text-muted-foreground"}`}
    >
      <Gavel className="h-3.5 w-3.5" />
      {empty ? (
        <>
          Jury drawn, {jury.filled} of {jury.seats} seats filled — nobody is eligible to sit yet.
          It is retried every hour.
        </>
      ) : (
        <>
          Jury sitting: {jury.filled} of {jury.seats} seats filled, {jury.voted} voted.
        </>
      )}
    </p>
  );
}

export function ReportsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "reports", filter],
    queryFn: () =>
      api.get<{ results: ReportRow[] }>(`/api/admin/reports?status=${filter}`, {
        headers: adminAuthHeader(),
      }),
  });

  const close = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "actioned" | "dismissed" }) =>
      api.post(`/api/admin/reports/${id}`, { status }, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("Report closed", {
        description: "The person who filed it has been told. Any jury on it carries on.",
      });
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not close that report"),
  });

  const ban = useMutation({
    mutationFn: (userId: string) =>
      api.post(`/api/admin/users/${userId}/ban`, {}, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("Account banned");
      void queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not ban that account"),
  });

  const reports = data?.results ?? [];
  const openCount = reports.filter((r) => r.status === "open").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
          <Flag className="h-5 w-5 text-accent" />
          Reports
          {filter === "open" && openCount > 0 ? (
            <Badge variant="secondary">{openCount} open</Badge>
          ) : null}
        </h2>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={filter === option ? "default" : "outline"}
              onClick={() => setFilter(option)}
              className="capitalize"
            >
              {option}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Reports are evidence, never an action. Nothing is hidden or removed because somebody
        complained — a jury of citizens decides conduct, and closing a report here does not stop
        one.
      </p>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <Flag className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            {filter === "open" ? "Nothing open." : `No ${filter} reports.`}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {reports.map((report) => {
            const about = report.reportedUser ?? report.post?.author ?? report.comment?.author;
            const content = report.post ?? report.comment;

            return (
              <div
                key={report.id}
                data-testid="report-row"
                className="border-b border-border p-4 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={report.status === "open" ? "default" : "secondary"}>
                    {report.status}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">
                    {REASON_LABELS[report.reason] ?? report.reason}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {handle(report.reporter)} reported{" "}
                    {report.reportedUser
                      ? handle(report.reportedUser)
                      : report.post
                        ? "a post"
                        : "a comment"}
                    {report.reportedUser ? "" : ` by ${handle(about)}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · {new Date(report.createdAt).toLocaleString()}
                  </span>
                  {about?.banned ? <Badge variant="destructive">banned</Badge> : null}
                </div>

                {/* WHAT THEY WROTE. Until the form existed, every report on the
                    platform arrived as "other" with this empty. */}
                {report.detail ? (
                  <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm text-foreground/90">
                    {report.detail}
                  </p>
                ) : (
                  <p className="mt-2 text-xs italic text-muted-foreground">
                    Nothing written. Filed before the report form existed, or left blank.
                  </p>
                )}

                {content ? (
                  <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
                    {content.deleted ? (
                      <span className="italic text-muted-foreground">
                        This has been deleted since.
                      </span>
                    ) : (
                      <span className="whitespace-pre-wrap text-foreground/90">
                        {content.content}
                      </span>
                    )}
                  </div>
                ) : null}

                <JuryState jury={report.jury} />

                {report.status === "open" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {about && !about.banned ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={ban.isPending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Ban ${handle(about)}? They lose access immediately. Any jury ` +
                                `hearing this report carries on regardless.`,
                            )
                          ) {
                            return;
                          }
                          ban.mutate(about.id);
                        }}
                      >
                        <ShieldBan className="mr-1.5 h-3.5 w-3.5" />
                        Ban {handle(about)}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="mark-handled"
                      disabled={close.isPending}
                      onClick={() => close.mutate({ id: report.id, status: "actioned" })}
                    >
                      <Check className="mr-1.5 h-3.5 w-3.5" /> Mark handled
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={close.isPending}
                      onClick={() => close.mutate({ id: report.id, status: "dismissed" })}
                    >
                      <X className="mr-1.5 h-3.5 w-3.5" /> Dismiss
                    </Button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {report.status === "actioned" ? "Handled" : "Dismissed"}
                    {report.reviewedBy ? ` by ${report.reviewedBy}` : ""}
                    {report.reviewedAt
                      ? ` on ${new Date(report.reviewedAt).toLocaleString()}`
                      : ""}
                    .
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
