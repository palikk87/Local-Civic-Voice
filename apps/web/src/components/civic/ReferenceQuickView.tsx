import { ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

import { RecordBadge } from "@/components/civic/RecordBadge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useGovernmentReference } from "@/hooks/use-government-references";

/**
 * THE WHOLE LAW, WITHOUT LEAVING THE SEARCH.
 *
 * A search result is a title and a number, which is not enough to know whether
 * it is the law you meant. This opens the record's own detail — who is behind
 * it and their face, its dates, what we hold on it, and the brief if one has
 * been written — over the results, so a reader can look and go back to looking.
 *
 * IT DOES NOT REPLACE THE PAGE. Voting, the conversation, the audit and the
 * pulse live on /reference/:id, and the footer goes there. This is for deciding
 * whether to.
 *
 * IT ASKS FOR NOTHING THAT COSTS MONEY. A brief already written is shown; one
 * that has not been is not commissioned from here — that is a button on the
 * full page, and a decision a person makes.
 */
/**
 * The same content, without a dialog around it.
 *
 * The law picker inside the composer is ALREADY a dialog, and stacking one on
 * another is how this platform got "two modals stack and the top one is inert".
 * So the picker renders this in place, over its own list, and Discover — which
 * has no dialog of its own — wraps it in one. One body, two frames, no stack.
 */
export function ReferenceQuickViewBody({ referenceId }: { referenceId: string | null }) {
  const { data, isLoading, isError } = useGovernmentReference(
    referenceId ?? undefined,
    !!referenceId,
  );
  const reference = data?.reference;

  const typeLabel =
    reference?.referenceType === "executive_order"
      ? "Executive order"
      : reference?.referenceType === "scotus_case"
        ? "Supreme Court case"
        : "Bill";

  const dates = reference
    ? [
        ["Introduced", reference.introducedDate],
        ["Signed", reference.signedDate],
        ["Decided", reference.decidedDate],
        ["Last action", reference.lastActionDate],
      ].filter((row): row is [string, string] => typeof row[1] === "string" && !!row[1])
    : [];

  return (
    <>
        {isLoading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the record…
          </div>
        ) : isError || !reference ? (
          <p className="py-10 text-sm text-muted-foreground">
            We couldn&apos;t load this record. It may have been merged into another one.
          </p>
        ) : (
          <>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-secondary-foreground">
                  {typeLabel}
                </span>
                <span className="text-xs text-muted-foreground">{reference.displayId}</span>
                {reference.completeness ? (
                  <RecordBadge completeness={reference.completeness} />
                ) : null}
              </div>
              <h2 className="text-left text-xl font-semibold leading-snug text-foreground">
                {reference.title}
              </h2>
            </div>

            {reference.attribution ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                {reference.attribution.photoUrl ? (
                  <img
                    src={reference.attribution.photoUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-full object-cover"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
                <p className="text-sm font-medium text-foreground">
                  {reference.attribution.role} {reference.attribution.name}
                </p>
              </div>
            ) : null}

            {reference.attribution?.panel?.length ? (
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {reference.attribution.panelLabel}
                </p>
                <div className="flex flex-wrap gap-2">
                  {reference.attribution.panel.map((justice) => (
                    <span
                      key={justice.name}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {justice.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {dates.length > 0 ? (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {dates.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-foreground">
                      {new Date(value).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {reference.citizenBriefSections?.summary ? (
              <div>
                <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Citizen&apos;s Brief
                </p>
                <p className="text-sm leading-relaxed text-foreground">
                  {reference.citizenBriefSections.summary}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Citizen&apos;s Brief has been written for this record yet. Open the full
                page to ask for one.
              </p>
            )}

            <Link
              to={`/reference/${reference.id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Open the full record
              <ExternalLink className="h-4 w-4" />
            </Link>
          </>
        )}
    </>
  );
}

/** The same thing in a dialog, for a screen that does not already have one. */
export function ReferenceQuickView({
  referenceId,
  onClose,
}: {
  referenceId: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!referenceId} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        {/*
          * The dialog needs a title of its own for assistive technology, and the
          * body cannot supply one: the body is also rendered INLINE, inside the
          * composer's law picker, where there is no Dialog to be a child of. A
          * DialogTitle there throws and takes the page down with it — which is
          * exactly what "when you click see details the page fails" was.
          *
          * So the accessible title lives here, with the dialog, and the visible
          * heading lives in the body, where both framings can use it.
          */}
        <DialogHeader className="sr-only">
          <DialogTitle>Record details</DialogTitle>
        </DialogHeader>
        <ReferenceQuickViewBody referenceId={referenceId} />
      </DialogContent>
    </Dialog>
  );
}
