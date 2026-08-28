/**
 * THE DECISION PAGE — Constitution Article IV.
 *
 * "Disputes are settled by randomly chosen trusted users."
 *
 * WHAT A JUROR SEES HERE IS EVERYTHING THE CASE CAN SHOW THEM: the post or the
 * comment itself, the law it points at, that law's citizen brief, what the
 * report said and why. Judging on a screenshot is not judging, so nothing is
 * summarised away.
 *
 * WHAT THEY DO NOT SEE, UNTIL THE VERDICT IS IN, is anything the accused has
 * been found to have done before. A jury that starts by reading somebody's
 * record is weighing the person and not the case. Afterwards it appears, where
 * it belongs — a reader needs it to put the decision in proportion.
 *
 * THE PAGE THEY CANNOT LEAVE IS THIS ONE, and it is honest about that. Once
 * they accept, everything else on the platform answers 423 until they have
 * voted or stepped aside. So the two ways out are on this page, in plain sight,
 * next to the vote: step aside with a reason, and a line saying exactly when
 * the platform will let them go on its own.
 */

import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel, Scale, ShieldAlert, Clock, FileText, ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { juries, panelSentence, reasonLabel, type JuryCase as CaseFile } from "@/lib/juries";
import { publicHandle } from "@/lib/public-identity";
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

function Panel({ children, tone }: { children: React.ReactNode; tone?: "danger" | "quiet" }) {
  return (
    <section
      className={cn(
        "mb-4 rounded-2xl border p-4",
        tone === "danger"
          ? "border-amber-500/40 bg-amber-500/10"
          : tone === "quiet"
            ? "border-border bg-muted/20"
            : "border-border bg-card",
      )}
    >
      {children}
    </section>
  );
}

/** The thing that was reported, in full, with the law it points at. */
function Evidence({ file }: { file: CaseFile }) {
  const content = file.comment ?? file.post;
  const reference = file.comment?.post?.governmentReference ?? file.post?.governmentReference ?? null;

  if (!content) {
    return (
      <Panel tone="quiet">
        <p className="text-sm text-muted-foreground" data-testid="jury-evidence-gone">
          What this report was about is no longer on the platform. The case can still be decided —
          but say so in your reasoning.
        </p>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {file.comment ? "The comment that was reported" : "The post that was reported"}
        </p>
        <p className="text-sm leading-6 text-foreground" data-testid="jury-evidence">
          {content.content}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          by @{publicHandle(content.author)} · {when(content.createdAt)}
        </p>
      </Panel>

      {file.comment?.post ? (
        <Panel tone="quiet">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            The post it was a comment on
          </p>
          <p className="text-sm leading-6 text-muted-foreground">{file.comment.post.content}</p>
        </Panel>
      ) : null}

      {reference ? (
        <Panel tone="quiet">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            The law it points at
          </p>
          <p className="text-sm font-medium text-foreground">{reference.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {reference.masterReferenceId} · {reference.status}
          </p>
          {reference.citizenBrief ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-muted-foreground" data-testid="jury-brief">
              {reference.citizenBrief}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              No citizen's brief has been written for this law yet.
            </p>
          )}
        </Panel>
      ) : null}
    </>
  );
}

export default function JuryCasePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [ballot, setBallot] = useState<"uphold" | "dismiss" | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [recusing, setRecusing] = useState(false);
  const [recusalReason, setRecusalReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rules = useQuery({ queryKey: ["juries", "rules"], queryFn: juries.rules });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["juries", "case", id],
    queryFn: () => juries.case(id),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["juries"] });
  };

  const accepting = useMutation({
    mutationFn: () => juries.accept(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not accept the summons."),
  });

  const deciding = useMutation({
    mutationFn: () => juries.verdict(id, ballot!, reasoning),
    onSuccess: () => {
      setError(null);
      setReasoning("");
      setBallot(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not record that verdict."),
  });

  const steppingAside = useMutation({
    mutationFn: () => juries.recuse(id, recusalReason),
    onSuccess: () => {
      setError(null);
      setRecusing(false);
      // Released. The rest of the platform is theirs again.
      queryClient.clear();
      navigate("/feed");
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not step aside."),
  });

  const file = data?.case;
  const minReasoning = rules.data?.minReasoningLength ?? 20;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl px-4 py-6">
        <button
          onClick={() => navigate(-1)}
          className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Scale className="h-5 w-5" />
          Community Jury
        </h1>

        {isLoading ? <p className="mt-6 text-sm text-muted-foreground">Opening the case…</p> : null}

        {isError ? (
          <p className="mt-6 text-sm text-muted-foreground" data-testid="jury-not-yours">
            This case is still being heard. It is published in full, with every juror's reasoning,
            once it is decided.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
            {error}
          </p>
        ) : null}

        {file ? (
          <div className="mt-4" data-testid="jury-case">
            <Panel tone={file.status === "decided" ? "quiet" : "danger"}>
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {file.status === "decided"
                      ? file.verdict === "upheld"
                        ? "This report was upheld"
                        : "This report was dismissed"
                      : `Reported as: ${reasonLabel(file.report.reason)}`}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {panelSentence(file)}
                    {file.accusedIsCivilLeader
                      ? ` This account holds ${file.accusedDelegations} delegated votes, so the panel is larger.`
                      : ""}
                  </p>
                  {file.report.detail ? (
                    <p className="mt-2 text-sm leading-6 text-foreground" data-testid="jury-report-detail">
                      “{file.report.detail}”
                    </p>
                  ) : null}
                </div>
              </div>
            </Panel>

            <Evidence file={file} />

            {/* THE SUMMONS. Accepting is the moment the platform closes. */}
            {file.viewer.seatState === "summoned" ? (
              <Panel>
                <p className="text-sm font-semibold text-foreground">You have been called</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  You were drawn at random. If you accept,{" "}
                  <strong className="text-foreground">
                    the platform closes around this case until you have voted
                  </strong>{" "}
                  — no feed, no messages, nothing else. There is no week to think about it. If you
                  do nothing by {file.viewer.answerBy ? when(file.viewer.answerBy) : "tomorrow"},
                  the seat goes to somebody else.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    data-testid="jury-accept"
                    disabled={accepting.isPending}
                    onClick={() => accepting.mutate()}
                    className="flex-1 rounded-xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50"
                  >
                    Accept the summons
                  </button>
                  <button
                    data-testid="jury-step-aside"
                    onClick={() => setRecusing(true)}
                    className="rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                  >
                    Step aside
                  </button>
                </div>
              </Panel>
            ) : null}

            {/* SEQUESTERED. The vote, and the two ways out, on one screen. */}
            {file.viewer.seatState === "accepted" ? (
              <Panel>
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Gavel className="h-4 w-4" /> Your decision
                </p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Did this break the Code of Conduct? Say what you decided and why — your reasoning
                  is published with the verdict, without your name on it.
                </p>

                <div className="mt-3 flex gap-2">
                  <button
                    data-testid="jury-uphold"
                    onClick={() => setBallot("uphold")}
                    className={cn(
                      "flex-1 rounded-xl border py-3 text-sm font-semibold",
                      ballot === "uphold"
                        ? "border-amber-500 bg-amber-500/15 text-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    It broke the rules
                  </button>
                  <button
                    data-testid="jury-dismiss"
                    onClick={() => setBallot("dismiss")}
                    className={cn(
                      "flex-1 rounded-xl border py-3 text-sm font-semibold",
                      ballot === "dismiss"
                        ? "border-emerald-500 bg-emerald-500/15 text-foreground"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    It did not
                  </button>
                </div>

                <textarea
                  data-testid="jury-reasoning"
                  value={reasoning}
                  onChange={(event) => setReasoning(event.target.value)}
                  rows={4}
                  placeholder={`Why? At least ${minReasoning} characters.`}
                  className="mt-3 w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground"
                />

                <button
                  data-testid="jury-submit"
                  disabled={deciding.isPending || !ballot || reasoning.trim().length < minReasoning}
                  onClick={() => deciding.mutate()}
                  className="mt-2 w-full rounded-xl bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-40"
                >
                  Record my verdict
                </button>

                <div className="mt-4 border-t border-border pt-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    If you do nothing, the platform releases you on its own
                    {file.viewer.releasedAt ? ` at ${when(file.viewer.releasedAt)}` : " within a day"}
                    , and the seat is redrawn.
                  </p>
                  <button
                    data-testid="jury-step-aside"
                    onClick={() => setRecusing(true)}
                    className="mt-2 text-xs font-medium text-muted-foreground underline"
                  >
                    Or step aside now, with a reason
                  </button>
                </div>
              </Panel>
            ) : null}

            {recusing ? (
              <Panel>
                <p className="text-sm font-semibold text-foreground">Stepping aside</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Sometimes you know the person, or the case is distressing, or you simply cannot be
                  fair to it. Forcing a verdict out of somebody who should not give one is worse
                  than redrawing. Say briefly why — it is recorded, and somebody else is drawn.
                </p>
                <textarea
                  data-testid="jury-recusal-reason"
                  value={recusalReason}
                  onChange={(event) => setRecusalReason(event.target.value)}
                  rows={3}
                  className="mt-3 w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    data-testid="jury-recuse-confirm"
                    disabled={steppingAside.isPending}
                    onClick={() => steppingAside.mutate()}
                    className="flex-1 rounded-xl border border-border py-3 text-sm font-medium text-foreground disabled:opacity-50"
                  >
                    Step aside
                  </button>
                  <button
                    onClick={() => setRecusing(false)}
                    className="rounded-xl px-4 py-3 text-sm text-muted-foreground"
                  >
                    Stay on the case
                  </button>
                </div>
              </Panel>
            ) : null}

            {file.viewer.hasVoted && file.status !== "decided" ? (
              <Panel tone="quiet">
                <p className="text-sm text-muted-foreground" data-testid="jury-voted">
                  Your verdict is recorded and you are free to go. The case closes when{" "}
                  {file.votesToDecide} jurors agree one way or the other.
                </p>
              </Panel>
            ) : null}

            {/* DECIDED. The verdict, the reasons, and only now the record. */}
            {file.status === "decided" ? (
              <>
                <Panel>
                  <p className="text-sm font-semibold text-foreground">What the jury said</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {file.tally.uphold} of {file.tally.uphold + file.tally.dismiss} jurors found it
                    broke the rules. Reasons are published without names.
                  </p>
                  <div className="mt-3 space-y-2">
                    {file.reasons.map((reason, index) => (
                      <div
                        key={index}
                        data-testid="jury-reason"
                        className="rounded-xl border border-border bg-muted/20 p-3"
                      >
                        <p className="text-xs font-medium text-muted-foreground">
                          {reason.vote === "uphold" ? "Broke the rules" : "Did not break the rules"}
                        </p>
                        <p className="mt-1 text-sm leading-6 text-foreground">{reason.reasoning}</p>
                      </div>
                    ))}
                  </div>
                </Panel>

                {file.priorFindings !== null ? (
                  <Panel tone="quiet">
                    <p className="text-sm text-muted-foreground" data-testid="jury-prior-findings">
                      {file.priorFindings === 0
                        ? "No jury has upheld a report against this account before."
                        : `${file.priorFindings} earlier report${file.priorFindings === 1 ? " has" : "s have"} been upheld against this account.`}{" "}
                      This was withheld from the jury until they had decided.
                    </p>
                  </Panel>
                ) : null}
              </>
            ) : null}

            {/* THE DRAW, so it can be checked afterwards. Never who. */}
            <Panel tone="quiet">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How this jury was drawn
              </p>
              <div className="mt-2 space-y-1">
                {file.draw.map((seat) => (
                  <p key={seat.id} className="text-xs text-muted-foreground" data-testid="jury-seat">
                    Seat summoned {when(seat.summonedAt)} — {seat.state}
                    {seat.replacesSeatId ? " (a replacement)" : ""}
                    {seat.isYou ? " — you" : ""}
                  </p>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Jurors are drawn at random from people who have earned delegate standing, never
                from the accused's own delegators, the reporter, or anybody blocked either way.
              </p>
            </Panel>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
