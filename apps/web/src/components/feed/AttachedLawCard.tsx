import { FileText, Landmark, Scale, X } from "lucide-react";

import { RecordBadge } from "@/components/civic/RecordBadge";
import { useGovernmentReference } from "@/hooks/use-government-references";

/**
 * THE LAW YOU ARE ABOUT TO POST ABOUT, SHOWN AS A LAW.
 *
 * Sharing from the Library dropped a single truncated line into the composer —
 * an icon, an identifier and as much of the title as fitted. Reported as: "I
 * don't like the dead nature of a post shared from the library… it feels so
 * bland."
 *
 * It is also the moment a person most needs to see what they have got. They
 * arrived here from a search result, and the thing they are about to put their
 * name to is a law they have read one line of.
 *
 * So this shows the record: which branch it came from, its number, its whole
 * title, who is behind it and their face, what we hold on it, and when it
 * happened. The same facts the law's own card carries, at the size of a
 * paragraph.
 *
 * IT ASKS FOR NOTHING THAT COSTS MONEY. The record is read; no brief is
 * commissioned from a composer. What is already written is not shown here
 * either — the point is to identify the law, not to publish somebody else's
 * summary into a box the reader is writing their own words in.
 */
export function AttachedLawCard({
  referenceId,
  fallbackTitle,
  fallbackIdentifier,
  onRemove,
}: {
  referenceId: string;
  fallbackTitle: string;
  fallbackIdentifier?: string | null;
  onRemove: () => void;
}) {
  const { data } = useGovernmentReference(referenceId);
  const reference = data?.reference;

  const type = reference?.referenceType;
  const Icon = type === "scotus_case" ? Scale : type === "bill" ? Landmark : FileText;
  const typeLabel =
    type === "executive_order"
      ? "Executive order"
      : type === "scotus_case"
        ? "Supreme Court"
        : type === "bill"
          ? "Bill"
          : "Record";

  // Whatever the record actually has a date for. A bill is introduced, an order
  // is signed, a ruling is decided — no row is invented to fill the shape.
  const dates = reference
    ? ([
        ["Introduced", reference.introducedDate],
        ["Signed", reference.signedDate],
        ["Decided", reference.decidedDate],
      ].filter((row): row is [string, string] => typeof row[1] === "string" && !!row[1]))
    : [];

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-start gap-2">
        <Icon size={15} className="mt-0.5 shrink-0 text-primary" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-secondary-foreground">
              {typeLabel}
            </span>
            {reference?.displayId ?? fallbackIdentifier ? (
              <span className="text-xs text-muted-foreground">
                {reference?.displayId ?? fallbackIdentifier}
              </span>
            ) : null}
            {reference?.completeness ? (
              <RecordBadge completeness={reference.completeness} />
            ) : null}
          </div>

          {/* Not truncated. The title is the thing being shared. */}
          <p className="mt-1 text-sm font-medium leading-snug text-foreground">
            {reference?.title ?? fallbackTitle}
          </p>

          {reference?.attribution ? (
            <div className="mt-2 flex items-center gap-2">
              {reference.attribution.photoUrl ? (
                <img
                  src={reference.attribution.photoUrl}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ) : null}
              <span className="text-xs text-muted-foreground">
                {reference.attribution.role} {reference.attribution.name}
              </span>
            </div>
          ) : null}

          {dates.length > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {dates
                .map(
                  ([label, value]) =>
                    `${label} ${new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    })}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted"
          aria-label="Remove attached reference"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
