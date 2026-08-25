/**
 * The split between Aye and Nay, drawn so both sides are visible.
 *
 * WHAT THIS REPLACES, AND WHY IT LOOKED BROKEN. Every copy of this bar drew one
 * green fill sized to the Aye share, over a plain grey track:
 *
 *     <div class="bg-slate-700">
 *       <div class="bg-emerald-500" style="width: {yea}%" />
 *     </div>
 *
 * The grey was a background, not the Nay share — nothing ever drew Nay at all.
 * So a record with two votes, both against, printed "100% Nay" beside a bar
 * that was entirely empty. It was not a rendering failure; the bar simply had
 * no way to express opposition, which on a platform whose whole subject is
 * whether people are for or against something is the wrong half to leave out.
 *
 * Both sides are drawn now, and they fill the track between them.
 *
 * NO VOTES IS ITS OWN STATE. With nothing cast, an empty track is honest and a
 * half-and-half split is not — a 50/50 bar over zero votes invents a tie
 * nobody voted for. One call site was doing exactly that.
 */

export function PulseBar({
  yea,
  nay,
  height = "h-3",
  className = "",
}: {
  yea: number;
  nay: number;
  /** Tailwind height class. The detail pages use h-3, cards use h-2. */
  height?: string;
  className?: string;
}) {
  const total = Math.max(0, yea) + Math.max(0, nay);
  const yeaPct = total > 0 ? (Math.max(0, yea) / total) * 100 : 0;
  const nayPct = total > 0 ? 100 - yeaPct : 0;

  return (
    <div
      className={`${height} flex overflow-hidden rounded-full bg-slate-700 ${className}`}
      role="img"
      aria-label={
        total > 0
          ? `${Math.round(yeaPct)} percent Aye, ${Math.round(nayPct)} percent Nay, ${total} votes`
          : "No votes yet"
      }
    >
      {total > 0 ? (
        <>
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${yeaPct}%` }}
          />
          <div className="h-full bg-red-500 transition-all" style={{ width: `${nayPct}%` }} />
        </>
      ) : null}
    </div>
  );
}
