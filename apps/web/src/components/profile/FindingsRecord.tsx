/**
 * "A jury found that this person misrepresented a law." On their profile.
 *
 * Bill of Rights Article V: "The community retains the right to Impeach or
 * demote any leader who violates the platform's integrity or SPREADS VERIFIABLE
 * FALSEHOODS, as determined by the collective will of their followers."
 *
 * WHY IT IS PERMANENT, and why only upheld ones are here: the same reasons as
 * the impeachment record beside it. This is a finding other people made about
 * how somebody used a public voice; a record that expires is one a person can
 * wait out, and a dismissed report on a profile would turn the right to report
 * into a way to mark somebody.
 *
 * THE REASONS ARE HERE IN FULL, unattributed. A verdict without them is a label,
 * and a label is the thing a reader cannot argue with.
 *
 * NOTHING WAS TAKEN AWAY BY THIS. No demotion, no suspension, no hidden reach
 * penalty — and the panel says so, because a reader who assumes the platform
 * has already punished somebody will not use the remedy that is actually
 * theirs. The people who lent this person a vote were told; what happens next
 * is theirs.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { juries, type LeaderFinding } from "@/lib/juries";

function on(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "an unrecorded date";
}

function Entry({ finding }: { finding: LeaderFinding }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
      <button
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-start gap-2 text-left"
        data-testid="finding-entry"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            A jury found this account misrepresented a law on {on(finding.decidedAt)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {finding.uphold} of {finding.uphold + finding.dismiss} jurors agreed.
            {finding.delegationsAtTheTime > 0
              ? ` ${finding.delegationsAtTheTime} people were lending them a vote at the time, and every one of them was told.`
              : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            {open ? "Hide" : "Read"} what was reported and what the jury said
          </p>
        </div>
      </button>

      {open ? (
        <div className="mt-3 space-y-2 border-t border-amber-500/30 pt-3">
          {finding.detail ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What was reported
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground">{finding.detail}</p>
            </div>
          ) : null}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What the jury said
            </p>
            {finding.reasons.map((reason, index) => (
              <p key={index} className="mt-1 text-sm leading-6 text-foreground">
                “{reason.reasoning}”
              </p>
            ))}
          </div>

          <Link
            to={`/jury/${finding.juryId}`}
            className="inline-block text-xs font-medium text-muted-foreground underline"
          >
            The whole case, including how the jury was drawn
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export function FindingsRecord({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["juries", "findings", userId],
    queryFn: () => juries.findings(userId),
    enabled: Boolean(userId),
  });

  const findings = data?.findings ?? [];
  // Renders nothing at all for almost every profile, which is the point.
  if (findings.length === 0) return null;

  return (
    <section className="mb-4" data-testid="findings-record">
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Findings against this account
        </h2>
      </div>
      <div className="space-y-2">
        {findings.map((finding) => (
          <Entry key={finding.juryId} finding={finding} />
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Nothing has been taken away from this account because of these. A jury decides whether
        something broke the rules; what to do about a person carrying your vote is yours to
        decide, and Article V is how you decide it.
      </p>
    </section>
  );
}
