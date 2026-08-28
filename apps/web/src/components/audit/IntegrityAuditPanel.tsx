/**
 * THE INTEGRITY AUDIT, ON A PAGE — Constitution Article III §2.
 *
 * "Any user or group of users may demand an Integrity Audit of a specific vote
 * if there is evidence of bot interference or system malfunction."
 *
 * THE BUTTON IS THE CLAUSE. There is no approval step and nothing to apply
 * for: pressing it runs the audit. That is what "demand" means, and a screen
 * that made it a request would be a different constitution.
 *
 * WHAT IT WILL NOT DO. It never shows a name, because the server never sends
 * one. It never says fraud — "worth reading" is the strongest thing on this
 * panel, and the sentence under the heading says out loud that a person draws
 * the conclusion. And when a figure covers too few people it prints the
 * withheld notice rather than a small number, using the floor the server
 * published rather than one typed here.
 *
 * WITH NOTHING AUDITED IT SAYS SO. No sample audit, no example findings.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, EyeOff, Loader2, ScanSearch } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import { articleV } from "@/lib/article-v";
import {
  audits,
  auditHeadline,
  detailLabel,
  type AuditFinding,
  type AuditSubjectType,
  type IntegrityAudit,
} from "@/lib/integrity-audit";
import { cn } from "@/lib/utils";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const entries = Object.entries(finding.detail);

  return (
    <div
      data-testid="audit-finding"
      className={cn(
        "rounded-xl border p-3",
        finding.status === "attention"
          ? "border-amber-500/40 bg-amber-500/10"
          : finding.status === "withheld"
            ? "border-border bg-muted/20"
            : "border-border bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2">
        {finding.status === "attention" ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        ) : finding.status === "withheld" ? (
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{finding.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{finding.summary}</p>

          {entries.length > 0 && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              {entries.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-2">
                  <dt className="truncate text-[11px] text-muted-foreground">
                    {detailLabel(key)}
                  </dt>
                  <dd className="text-[11px] font-medium tabular-nums text-foreground">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditBody({ audit }: { audit: IntegrityAudit }) {
  return (
    <div className="space-y-2" data-testid="integrity-audit">
      <p className="text-xs text-muted-foreground">
        Audited {when(audit.runAt)}
        {audit.automatic ? " — run automatically when the articles were filed." : "."}{" "}
        {auditHeadline(audit)}
      </p>
      {audit.findings.map((finding) => (
        <FindingRow key={finding.id} finding={finding} />
      ))}
    </div>
  );
}

export function IntegrityAuditPanel({
  subjectType,
  subjectId,
  title = "Integrity Audit",
  /** What this audit is of, in the reader's words. */
  what,
}: {
  subjectType: AuditSubjectType;
  subjectId: string;
  title?: string;
  what: string;
}) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const historyKey = ["integrity-audit", subjectType, subjectId];

  const { data, isLoading } = useQuery({
    queryKey: historyKey,
    queryFn: () => audits.history(subjectType, subjectId),
    enabled: Boolean(subjectId),
  });

  const demand = useMutation({
    mutationFn: () => audits.demand(subjectType, subjectId),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: historyKey });
    },
    onError: (caught: unknown) => {
      setError(caught instanceof Error ? caught.message : "The audit could not be run.");
    },
  });

  const history = data?.audits ?? [];
  const latest = history[0] ?? null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ScanSearch className="h-4 w-4 text-muted-foreground" />
            {title}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            An audit counts {what}. It reports patterns and never accuses, and it never
            names anybody — a person draws the conclusion.
          </p>
        </div>

        {session?.user && (
          <button
            type="button"
            onClick={() => demand.mutate()}
            disabled={demand.isPending}
            data-testid="request-audit"
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {demand.isPending ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Auditing
              </span>
            ) : (
              "Request an audit"
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-500" data-testid="audit-error">
          {error}
        </p>
      )}

      <div className="mt-3">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Looking for audits…</p>
        ) : latest ? (
          <AuditBody audit={latest} />
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="no-audit-yet">
            Nothing here has been audited yet.
            {session?.user ? " Anyone can ask for one." : " Sign in to ask for one."}
          </p>
        )}
      </div>

      {history.length > 1 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {history.length} audits on record, kept permanently — the quiet ones beside the
          rest.
        </p>
      )}
    </section>
  );
}

/**
 * The audit panel on a profile — shown only for somebody who actually holds
 * delegated votes.
 *
 * WHY THE CONDITION. This panel is about lent voice. On an account nobody has
 * lent to there is nothing to count, and every finding would be withheld — a
 * box of "cannot report" on every profile on the platform, which teaches people
 * to stop reading it. It appears the moment somebody is carrying a voice, which
 * is the moment it starts to matter.
 *
 * It reuses the Article V query rather than adding a second one, so a profile
 * asks the server once for both the record and this.
 */
export function DelegateAuditPanel({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["article-v", "leader", userId],
    queryFn: () => articleV.forLeader(userId),
    enabled: Boolean(userId),
  });

  if (!data || data.delegatorCount === 0) return null;

  return (
    <IntegrityAuditPanel
      subjectType="leader"
      subjectId={userId}
      title="Integrity Audit of this support"
      what="the votes lent to this person, as totals and timings"
    />
  );
}
