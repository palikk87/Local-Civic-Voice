/**
 * The Citizen's Brief card.
 *
 * Three parts, always in this order and always with these headings, because
 * the headings are the product:
 *
 *   THE BRIEF        one neutral paragraph — what this law does
 *   THE CASE FOR     two to three sentences
 *   THE CASE AGAINST two to three sentences
 *
 * Both sides are shown together and given equal weight on the page. A reader
 * who only sees the summary learns what the law says; a reader who sees both
 * arguments can decide what they think about it, which is the point.
 *
 * Four states, and every one of them is somewhere a reader can stand: the offer
 * (a button), the wait, the brief, and an honest "no text to read from". There
 * is deliberately no fifth state where something is happening that the reader
 * cannot see the end of.
 */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { CitizenBriefSections } from "@/lib/civic";
import { cn } from "@/lib/utils";

export interface CitizensBriefCardProps {
  state: "idle" | "working" | "ready" | "unavailable";
  brief: CitizenBriefSections | null;
  /** The server's words for why there is no brief. */
  reason?: string | null;
  isRequesting?: boolean;
  onRequest: () => void;
  onRewrite?: () => void;
  /** Link to the official document — the source everything here came from. */
  sourceUrl?: string | null;
  sourceLabel?: string;
  /** What the brief would summarize, for the empty state's one-liner. */
  emptyDescription?: string;
  /**
   * The stored brief describes an older text of this law. Shown with the brief
   * rather than instead of it: what exists is still worth reading, and hiding
   * that it is behind would be the lie.
   */
  isStale?: boolean;
  className?: string;
}

/**
 * The wait, told as what is actually happening.
 *
 * Writing a brief takes thirty to forty-five seconds, because the whole law is
 * read before a word is written. That is a long time to look at a spinner, and
 * a spinner says only "something is happening, possibly forever" — so people
 * leave, and the work they paid for finishes for nobody.
 *
 * These stages are the real ones, in the real order the pipeline runs them:
 * fetch the official text, read it (in sections when the law is long), write
 * from the notes, then check every claim back against the source. Nothing here
 * is invented to fill the time. The timings are what the pipeline typically
 * takes; if a stage runs long the message simply stays, which is honest — it IS
 * still doing that.
 *
 * The last line never changes, because it is the reason the wait is worth it:
 * this happens once for everybody, not once per reader.
 */
const STAGES: Array<{ after: number; text: string }> = [
  { after: 0, text: "Fetching the official text…" },
  { after: 6, text: "Reading the law in full…" },
  { after: 18, text: "Writing the brief…" },
  { after: 32, text: "Checking every claim against the text…" },
];

function BriefInProgress({ className }: { className?: string }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(tick);
  }, []);

  const stage = [...STAGES].reverse().find((s) => seconds >= s.after) ?? STAGES[0]!;
  const reached = STAGES.filter((s) => seconds >= s.after).length;

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cn("rounded-2xl border border-accent/20 bg-accent/10 p-8", className)}
    >
      <div className="flex flex-col items-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />

        <p
          key={stage.text}
          className="mt-4 animate-in fade-in text-base font-semibold text-foreground duration-500"
        >
          {stage.text}
        </p>

        {/* Which of the four steps this is. Movement a reader can trust,
            because each dot lights when that step genuinely starts. */}
        <div className="mt-4 flex items-center gap-1.5" aria-hidden="true">
          {STAGES.map((s, index) => (
            <span
              key={s.after}
              className={cn(
                "h-1.5 rounded-full transition-all duration-500",
                index < reached ? "w-6 bg-accent" : "w-1.5 bg-accent/25",
              )}
            />
          ))}
        </div>

        <p className="mt-4 max-w-sm text-center text-sm text-muted-foreground">
          The whole document is read before a word is written, and the brief is saved for
          everyone — so this happens once, not once per reader.
        </p>
      </div>
    </MotionDiv>
  );
}

export function CitizensBriefCard({
  state,
  brief,
  reason,
  isRequesting = false,
  onRequest,
  onRewrite,
  sourceUrl,
  sourceLabel = "Read the full official text",
  emptyDescription = "A plain-English summary of this law, written only from its full official text — plus the case for it and the case against it",
  isStale = false,
  className,
}: CitizensBriefCardProps) {
  const sourceLink = sourceUrl ? (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-muted py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/70"
    >
      <ExternalLink className="h-4 w-4" />
      {sourceLabel}
    </a>
  ) : null;

  if (state === "working") return <BriefInProgress className={className} />;

  if (state === "idle" || !brief) {
    const unavailable = state === "unavailable";
    return (
      <MotionDiv
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={cn("rounded-2xl border border-accent/20 bg-accent/10 p-5", className)}
      >
        <div className="flex flex-col items-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent/20">
            <Sparkles className="h-8 w-8 text-accent" />
          </div>
          <p className="mb-2 text-center text-lg font-bold text-foreground">Citizen's Brief</p>
          <p className="mb-4 max-w-sm px-2 text-center text-sm text-muted-foreground">
            {emptyDescription}
          </p>

          {unavailable ? (
            <p className="mb-6 max-w-sm px-2 text-center text-sm text-muted-foreground">
              {reason}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onRequest}
            disabled={isRequesting}
            className={cn(
              "flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-bold text-slate-900 transition-transform active:scale-95",
              isRequesting ? "bg-accent/50" : "bg-accent hover:bg-accent/90",
            )}
          >
            {isRequesting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : unavailable ? (
              <RefreshCw className="h-5 w-5" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
            <span className="text-base">
              {unavailable ? "Check the source again" : "Get the Citizen's Brief"}
            </span>
          </button>

          {sourceLink}
        </div>
      </MotionDiv>
    );
  }

  return (
    <MotionDiv
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className={cn("overflow-hidden rounded-2xl border border-border bg-card p-5", className)}
    >
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20">
            <Sparkles className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">Citizen's Brief</p>
            <p className="text-xs text-muted-foreground">
              Written only from the full official text
            </p>
          </div>
        </div>
        {onRewrite ? (
          <button
            type="button"
            onClick={onRewrite}
            disabled={isRequesting}
            aria-label="Rewrite this brief"
            className="rounded-lg bg-muted p-2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isRequesting && "animate-spin")} />
          </button>
        ) : null}
      </div>

      {isStale ? (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-sm text-amber-300">
            This law has changed since this brief was written. It describes the earlier text.
          </p>
        </div>
      ) : null}

      {/* The neutral paragraph. No icon, no colour, no framing — it is the
          plain account of the law, and dressing it up would editorialize it. */}
      <p className="text-base leading-relaxed text-foreground/90">{brief.summary}</p>

      {/* Both sides, side by side and identically weighted. Different colours
          so they are distinguishable at a glance; the same size, the same
          border, the same everything else, so neither reads as the answer. */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <ThumbsUp className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              The Case For
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{brief.argumentFor}</p>
        </div>

        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4">
          <div className="mb-2 flex items-center gap-2">
            <ThumbsDown className="h-4 w-4 text-rose-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
              The Case Against
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{brief.argumentAgainst}</p>
        </div>
      </div>

      {sourceLink}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Written from the complete official text of this law and nothing else. Read the text
        itself for the full detail.
      </p>
    </MotionDiv>
  );
}
