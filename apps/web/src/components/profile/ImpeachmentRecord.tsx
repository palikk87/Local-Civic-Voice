/**
 * "This person has been impeached." On their profile, permanently.
 *
 * WHY IT IS PERMANENT. A successful impeachment is not a punishment the
 * platform handed down — it is a finding two thirds of somebody's own
 * delegators made about how they used borrowed power. Anybody deciding whether
 * to lend them a vote is entitled to know it happened, and a record that
 * expires is one a person can simply wait out.
 *
 * WHY ONLY SUCCESSFUL ONES. Filing costs nothing but standing, and the
 * proceeding runs whatever anybody thinks of it. If a failed accusation stayed
 * on a profile, the right to bring a charge would double as a way to mark
 * somebody, which is the opposite of what Article V is for. The server never
 * sends those; this component could not show them if it wanted to.
 *
 * THE ARTICLES ARE HERE IN FULL. Not a summary, not a badge on its own — the
 * grounds and the evidence as they were filed, so a reader judges the
 * accusation rather than the label.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Gavel } from "lucide-react";
import { articleV, personLabel, type ImpeachmentRecordEntry } from "@/lib/article-v";
import { cn } from "@/lib/utils";

function on(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }) : "an unrecorded date";
}

function Entry({ entry }: { entry: ImpeachmentRecordEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        entry.inForce
          ? "border-red-500/40 bg-red-500/10"
          : "border-border bg-muted/30",
      )}
    >
      <button
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-start gap-2 text-left"
        data-testid="impeachment-record-entry"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Impeached on {on(entry.decidedAt)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {entry.votes} of {entry.electorCount} of their delegators voted to impeach.
            {entry.inForce
              ? ` Suspended from receiving delegations until ${on(entry.suspendedUntil)}.`
              : entry.suspendedUntil
                ? ` The suspension ran until ${on(entry.suspendedUntil)} and has ended.`
                : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/80">
            {open ? "Hide" : "Read"} the Articles of Impeachment
          </p>
        </div>
      </button>

      {open ? (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
          <p className="text-xs text-muted-foreground">
            Filed by {personLabel(entry.filedBy)} on {on(entry.openedAt)}
          </p>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Grounds
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {entry.grounds}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {entry.evidence}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ImpeachmentRecord({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["article-v", "leader", userId],
    queryFn: () => articleV.forLeader(userId),
    enabled: !!userId,
  });

  // NOTHING TO SAY IS SAID BY SAYING NOTHING. Almost every profile has an empty
  // record, and a heading reading "no impeachments" on all of them would make
  // the platform look like a place where this is expected.
  if (!data || data.record.length === 0) return null;

  const inForce = data.record.some((entry) => entry.inForce);

  return (
    <section className="mt-6" data-testid="impeachment-record">
      <div className="mb-2 flex items-center gap-2">
        <Gavel className="h-4 w-4 text-red-500" />
        <h2 className="text-sm font-semibold text-foreground">
          Article V record
        </h2>
      </div>

      <p className="mb-3 text-xs leading-5 text-muted-foreground">
        {inForce
          ? "This person is currently suspended from receiving delegated votes. " +
            "Everything else about their account is unaffected — they can post, " +
            "comment, share, and cast their own vote."
          : "This person has been impeached by their own delegators. The suspension " +
            "has ended and they can receive delegations again; the record stays."}
      </p>

      <div className="space-y-2">
        {data.record.map((entry) => (
          <Entry key={entry.id} entry={entry} />
        ))}
      </div>
    </section>
  );
}
