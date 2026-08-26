/**
 * Maintenance jobs, as buttons.
 *
 * WHY THIS EXISTS. Both of these were shell scripts, and a shell script needs
 * somebody with a terminal on the production service. The person who NOTICES
 * that a law's text is actually a captcha is whoever is reading the app — very
 * often on a phone — and making them find a terminal is how a known problem
 * stays live for a week while everybody waits for the one person who can run it.
 *
 * The scripts still exist and still work. They call the same code these buttons
 * call, so the two can never disagree about what a block page is.
 *
 * DESTRUCTIVE HALF IS NEVER THE ACCIDENTAL HALF. The purge reports first and
 * writes only when asked a second time, with the count of what it found in
 * front of you. On a database shared with another project that is the only
 * responsible default.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Check, Download, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";

interface BlockedRecord {
  masterReferenceId: string;
  referenceType: string;
  title: string;
  matched: string;
  hadBrief: boolean;
}

interface PurgeResponse {
  data: {
    examined: number;
    applied: boolean;
    cleared: number;
    found: BlockedRecord[];
    message: string;
  };
}

interface BackfillResponse {
  data: {
    requestedMaxNew: number;
    touched: number;
    added: number;
    gainedText: number;
    total: number;
    totalWithText: number;
    message: string;
  };
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="font-display text-lg font-semibold text-foreground">{title}</h3>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

export function MaintenanceTab() {
  const [purge, setPurge] = useState<PurgeResponse["data"] | null>(null);
  const [backfill, setBackfill] = useState<BackfillResponse["data"] | null>(null);
  const [maxNew, setMaxNew] = useState(100);

  const purgeMutation = useMutation({
    mutationFn: (apply: boolean) =>
      api.post<PurgeResponse>(
        `/api/admin/maintenance/purge-blocked-text?apply=${apply}`,
        {},
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => {
      setPurge(response.data);
      if (response.data.applied) toast.success(response.data.message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      api.post<BackfillResponse>(
        `/api/admin/maintenance/backfill-executive-orders?maxNew=${maxNew}`,
        {},
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => {
      setBackfill(response.data);
      toast.success(`Added ${response.data.added}, ${response.data.gainedText} gained text.`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-5">
      <Card title="Official text that is really a block page">
        <p className="text-sm text-muted-foreground">
          The Federal Register serves an anti-scraping page to servers, as HTTP 200. Before the
          guard landed, that page could be stored as the text of an executive order — then hashed
          as the law&rsquo;s fingerprint, and summarised by the AI into a Citizen&rsquo;s Brief
          published under Support and Oppose buttons. This finds those records and clears the text,
          the hash, and any brief written from it. Votes, posts and comments are never touched.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={purgeMutation.isPending}
            onClick={() => purgeMutation.mutate(false)}
          >
            {purgeMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldAlert className="mr-2 h-4 w-4" />
            )}
            Check — writes nothing
          </Button>

          {/* Only offered once there is something to clear, and it says how
              many. A destructive button with no number on it is a dare. */}
          {purge && purge.found.length > 0 && !purge.applied ? (
            <Button
              variant="destructive"
              disabled={purgeMutation.isPending}
              onClick={() => purgeMutation.mutate(true)}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Clear {purge.found.length}
            </Button>
          ) : null}
        </div>

        {purge ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="text-sm text-foreground">{purge.message}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {purge.examined} record{purge.examined === 1 ? "" : "s"} hold text and were examined.
            </p>
            {purge.found.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {purge.found.map((record) => (
                  <li key={record.masterReferenceId} className="text-xs">
                    <span className="font-mono text-foreground">{record.masterReferenceId}</span>{" "}
                    <span className="text-muted-foreground">
                      — matched &ldquo;{record.matched}&rdquo;
                      {record.hadBrief ? " · had a brief written from it" : ""}
                    </span>
                    <p className="truncate text-muted-foreground/80">{record.title}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card title="Catch the executive orders up">
        <p className="text-sm text-muted-foreground">
          The nightly sync takes at most 50 new orders a run, deliberately — the Federal Register
          publishes over 1,500, and pulling them all in one night is that many full-text downloads
          against a public server. This raises the ceiling for one run, while somebody is watching.
          Safe to repeat: anything already held is skipped without a download.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-muted-foreground" htmlFor="maxNew">
            At most
          </label>
          <input
            id="maxNew"
            type="number"
            min={1}
            max={300}
            value={maxNew}
            onChange={(e) => setMaxNew(Number(e.target.value))}
            className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
          />
          <Button disabled={backfillMutation.isPending} onClick={() => backfillMutation.mutate()}>
            {backfillMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Backfill
          </Button>
        </div>

        {backfillMutation.isPending ? (
          <p className="text-xs text-muted-foreground">
            Running now — this takes a few minutes for a few hundred, because each new order is a
            separate download and the pace is deliberately polite.
          </p>
        ) : null}

        {backfill ? (
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="flex items-center gap-1.5 text-foreground">
              <Check className="h-4 w-4 text-support" />
              {backfill.added} added, {backfill.gainedText} gained official text.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {backfill.totalWithText} of {backfill.total} executive orders now hold their text.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{backfill.message}</p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
