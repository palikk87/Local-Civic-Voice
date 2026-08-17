/**
 * The Citizen's Brief, in four states and one button.
 *
 * The shape is the reference app's: an empty card that invites, a working card
 * that explains the wait, and a three-section card — The Goal, The Wallet, The
 * Debate — when there is something to read. The difference is that every state
 * here is somewhere the reader can stand. The old one had a fourth state it
 * could enter and never leave, which is what "stuck in a load loop" was.
 *
 * The section labels come from the server, because they are not the same for
 * every branch: a court case has a Question and a Ruling, not a Wallet.
 */
import { ExternalLink, Loader2, RefreshCw, Scale, Sparkles, Target, Wallet } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { CitizenBriefLabels, CitizenBriefSections } from "@/lib/civic";
import { cn } from "@/lib/utils";

export interface CitizensBriefCardProps {
  state: "idle" | "working" | "ready" | "unavailable";
  brief: CitizenBriefSections | null;
  labels: CitizenBriefLabels | null;
  /** The server's words for why there is no brief. */
  reason?: string | null;
  isRequesting?: boolean;
  onRequest: () => void;
  onRewrite?: () => void;
  /** Link to the official document, always offered — it is the primary source. */
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

const SECTION_STYLE = [
  { Icon: Target, color: "#10B981", iconBg: "bg-emerald-500/20", text: "text-emerald-400" },
  { Icon: Wallet, color: "#F59E0B", iconBg: "bg-amber-500/20", text: "text-amber-400" },
  { Icon: Scale, color: "#A78BFA", iconBg: "bg-purple-500/20", text: "text-purple-400" },
] as const;

export function CitizensBriefCard({
  state,
  brief,
  labels,
  reason,
  isRequesting = false,
  onRequest,
  onRewrite,
  sourceUrl,
  sourceLabel = "View the official text",
  emptyDescription = "A plain-English summary, written from the complete official text",
  isStale = false,
  className,
}: CitizensBriefCardProps) {
  const sourceLink =
    sourceUrl ? (
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

  // Being written right now. The subtext is the honest one: the wait buys
  // something permanent, because the result is stored for everyone after.
  if (state === "working") {
    return (
      <MotionDiv
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
        className={cn("rounded-2xl border border-accent/20 bg-accent/10 p-8", className)}
      >
        <div className="flex flex-col items-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <p className="mt-4 text-base font-semibold text-foreground">
            Reading the official text…
          </p>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Pulling the complete official text and writing the brief. This is saved for everyone,
            so it only happens once.
          </p>
        </div>
      </MotionDiv>
    );
  }

  // Nothing written yet, or nothing that still describes this law. Either way
  // the offer is the same, and it is an offer rather than something already
  // happening.
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
          <p className="mb-4 px-4 text-center text-sm text-muted-foreground">{emptyDescription}</p>

          {unavailable ? (
            <p className="mb-6 px-4 text-center text-sm text-muted-foreground">
              {reason ??
                "The official text for this document isn't published anywhere we can read yet, so there's no brief to show. Rather than guess at what it says, we're not showing one."}
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
              {unavailable ? "Check the source again" : "Get Citizen Brief"}
            </span>
          </button>

          {sourceLink}
        </div>
      </MotionDiv>
    );
  }

  const bodies = [brief.theGoal, brief.theWallet, brief.theDebate];
  const headings = [
    labels?.goal ?? "The Goal",
    labels?.wallet ?? "The Wallet",
    labels?.debate ?? "The Debate",
  ];

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
              Written from the complete official text
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

      {SECTION_STYLE.map((style, index) => {
        const body = bodies[index];
        if (!body?.trim()) return null;
        const { Icon } = style;
        return (
          <div key={headings[index]} className={index === SECTION_STYLE.length - 1 ? "mb-4" : "mb-5"}>
            <div className="mb-3 flex items-center gap-2">
              <div
                className={cn("flex h-8 w-8 items-center justify-center rounded-lg", style.iconBg)}
              >
                <Icon className="h-[18px] w-[18px]" style={{ color: style.color }} />
              </div>
              <span className={cn("text-sm font-bold uppercase tracking-wider", style.text)}>
                {headings[index]}
              </span>
            </div>
            <p className="pl-10 text-base leading-relaxed text-foreground/90">{body}</p>
          </div>
        );
      })}

      {sourceLink}

      <p className="mt-4 text-center text-xs text-muted-foreground">
        AI summary of the complete official text. Read the official text for full details.
      </p>
    </MotionDiv>
  );
}
