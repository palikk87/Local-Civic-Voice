/**
 * ARTICLE V — SELF-CORRECTION, on real proceedings.
 *
 * WHAT THIS PAGE USED TO BE. Three hardcoded people — "Dr. Sarah Chen",
 * "Marcus Rivera", "James Park" — with invented trust scores, invented
 * follower counts and invented impeachment tallies, and a Vote to Impeach
 * button that added a string to a Set in this component. It did not even
 * increment the number beside it. Reload and it was gone. The System Reset
 * tab showed "12,450 for, 45,230 against, 94,000 eligible", none of which had
 * ever existed.
 *
 * That is the worst kind of invented data: a screen where a citizen believes
 * they have exercised a constitutional power and nothing at all has happened.
 *
 * Everything below reads the server. When nothing is happening, the page says
 * nothing is happening — an empty state that explains the mechanism is a
 * finished feature; a fabricated proceeding is not.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertTriangle,
  RotateCcw,
  Users,
  CheckCircle,
  Clock,
  Gavel,
  FileText,
  BookOpen,
  ShieldAlert,
  Scale,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRequireAuth, useCurrentUser } from "@/hooks/use-civic-auth";
import {
  articleV,
  daysLeft,
  hoursLeft,
  personLabel,
  type ImpeachmentProceeding,
  type MyDelegation,
  type SystemResetState,
} from "@/lib/article-v";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Panel({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "danger";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-4 rounded-2xl border p-4",
        tone === "danger"
          ? "border-red-700/50 bg-red-900/25"
          : tone === "warning"
            ? "border-amber-700/40 bg-amber-900/20"
            : "border-slate-700/50 bg-slate-800/60",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * An empty state that teaches the mechanism.
 *
 * The old page could not have one — it always had three people on it. This is
 * what honest looks like: nothing is happening, here is what would have to
 * happen for something to.
 */
function Nothing({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <div className="flex items-start gap-3">
        <Scale className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <div>
          <p className="font-semibold text-white">{title}</p>
          <div className="mt-1 space-y-2 text-sm leading-6 text-slate-400">{children}</div>
        </div>
      </div>
    </Panel>
  );
}

function Articles({ grounds, evidence }: { grounds: string; evidence: string }) {
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-slate-700/50 bg-slate-900/50 p-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Grounds</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{grounds}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{evidence}</p>
      </div>
    </div>
  );
}

function Bar({ value, max, tone }: { value: number; max: number; tone: "amber" | "red" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-700">
      <div
        className={cn("h-full rounded-full", tone === "red" ? "bg-red-500" : "bg-amber-500")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Grounds + evidence, with the server's own length rules enforced in the form. */
function ArticlesForm({
  minLength,
  maxLength,
  submitLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  minLength: number;
  maxLength: number;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (grounds: string, evidence: string) => void;
  onCancel: () => void;
}) {
  const [grounds, setGrounds] = useState("");
  const [evidence, setEvidence] = useState("");
  const ready = grounds.trim().length >= minLength && evidence.trim().length >= minLength;

  return (
    <div className="mt-3 space-y-3">
      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Grounds — what they are accused of
        </label>
        <textarea
          data-testid="articles-grounds"
          value={grounds}
          onChange={(event) => setGrounds(event.target.value.slice(0, maxLength))}
          rows={4}
          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 outline-none focus:border-slate-500"
          placeholder="State the accusation plainly."
        />
        <p className="mt-1 text-xs text-slate-500">
          {grounds.trim().length} of at least {minLength} characters
        </p>
      </div>

      <div>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Evidence — what shows it
        </label>
        <textarea
          data-testid="articles-evidence"
          value={evidence}
          onChange={(event) => setEvidence(event.target.value.slice(0, maxLength))}
          rows={4}
          className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 outline-none focus:border-slate-500"
          placeholder="Point at what anybody can check."
        />
        <p className="mt-1 text-xs text-slate-500">
          {evidence.trim().length} of at least {minLength} characters
        </p>
      </div>

      {/* Said before they file, not after. */}
      <p className="rounded-xl border border-amber-700/40 bg-amber-900/20 p-3 text-xs leading-5 text-amber-200/90">
        This is a formal filing. It is delivered to the person it names, in their inbox and by
        email, and it goes to the platform's administrators. Nobody can stop the proceeding once
        it starts — but a filing made in bad faith is grounds for suspending or banning the
        person who made it.
      </p>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex gap-2">
        <button
          data-testid="articles-submit"
          disabled={!ready || busy}
          onClick={() => onSubmit(grounds.trim(), evidence.trim())}
          className={cn(
            "flex-1 rounded-xl py-3 font-semibold transition-colors",
            ready && !busy
              ? "bg-red-600 text-white hover:bg-red-500"
              : "cursor-not-allowed bg-slate-700/50 text-slate-500",
          )}
        >
          {busy ? "Filing…" : submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="rounded-xl border border-slate-700 px-4 py-3 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Impeachment
// ---------------------------------------------------------------------------

function ProceedingCard({
  proceeding,
  onVote,
  onWithdraw,
  busy,
}: {
  proceeding: ImpeachmentProceeding;
  onVote: (id: string, days: number) => void;
  onWithdraw: (id: string) => void;
  busy: boolean;
}) {
  const [days, setDays] = useState(30);
  const open = proceeding.status === "open";
  const needed = Math.ceil(proceeding.electorCount * 0.66);

  return (
    <Panel
      tone={proceeding.status === "passed" ? "danger" : open ? "warning" : "neutral"}
      className="mb-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold text-white">{personLabel(proceeding.leader)}</p>
          <p className="text-sm text-slate-400">
            Filed by {personLabel(proceeding.filedBy)}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            proceeding.status === "passed"
              ? "bg-red-500/20 text-red-300"
              : open
                ? "bg-amber-500/20 text-amber-300"
                : "bg-slate-600/30 text-slate-300",
          )}
        >
          {proceeding.status === "passed"
            ? "Impeached"
            : open
              ? `${daysLeft(proceeding.expiresAt)} days left`
              : "Closed without two thirds"}
        </span>
      </div>

      <Articles grounds={proceeding.grounds} evidence={proceeding.evidence} />

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-slate-400">Votes to impeach</span>
          <span className="font-medium text-amber-300">
            {proceeding.votes} of {proceeding.electorCount} — {needed} needed
          </span>
        </div>
        <Bar
          value={proceeding.votes}
          max={Math.max(needed, 1)}
          tone={proceeding.status === "passed" ? "red" : "amber"}
        />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Two thirds of the people who were delegating to {personLabel(proceeding.leader)} when
          this was filed. Nobody who delegated afterwards has a vote.
        </p>
      </div>

      {proceeding.status === "passed" && proceeding.suspendedUntil ? (
        <p className="mt-3 text-sm text-red-200">
          Suspended from receiving delegations until{" "}
          {new Date(proceeding.suspendedUntil).toLocaleDateString()}. Their account, followers,
          posts and their own vote are untouched.
        </p>
      ) : null}

      {open ? (
        proceeding.viewerHasVoted ? (
          <div className="mt-4">
            <div className="flex items-center gap-2 rounded-xl bg-slate-700/40 py-3 pl-3">
              <CheckCircle size={18} className="text-emerald-400" />
              <span className="text-sm font-medium text-emerald-300">
                You voted to impeach
                {proceeding.viewerProposedDays
                  ? `, and proposed ${proceeding.viewerProposedDays} days`
                  : ""}
              </span>
            </div>
            <button
              data-testid="impeachment-withdraw"
              disabled={busy}
              onClick={() => onWithdraw(proceeding.id)}
              className="mt-2 w-full rounded-xl border border-slate-700 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Take my vote back
            </button>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block text-xs text-slate-400">
              How long should the suspension run? The average of everybody who votes sets the
              date.
            </label>
            <input
              data-testid="impeachment-days"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-2 text-sm text-slate-100"
            />
            <button
              data-testid="impeachment-vote"
              disabled={busy || days < 1 || days > 365}
              onClick={() => onVote(proceeding.id, days)}
              className="flex w-full items-center justify-center rounded-xl bg-red-600/80 py-3 font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-slate-700/50 disabled:text-slate-500"
            >
              <Gavel size={18} className="mr-2" />
              Vote to impeach
            </button>
          </div>
        )
      ) : null}
    </Panel>
  );
}

function FileAgainstDelegate({
  delegation,
  minLength,
  maxLength,
  onFiled,
}: {
  delegation: MyDelegation;
  minLength: number;
  maxLength: number;
  onFiled: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filing = useMutation({
    mutationFn: ({ grounds, evidence }: { grounds: string; evidence: string }) =>
      articleV.file(delegation.toUser.id, grounds, evidence),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      onFiled();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not file."),
  });

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-white">{personLabel(delegation.toUser)}</p>
          <p className="text-xs text-slate-400">
            {delegation.category
              ? `You delegate your vote on ${delegation.category}`
              : "You delegate your vote across every category"}
          </p>
        </div>
        {!open ? (
          <button
            data-testid="open-articles-form"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-xl border border-red-700/50 px-3 py-2 text-sm text-red-300 hover:bg-red-900/30"
          >
            File Articles
          </button>
        ) : null}
      </div>

      {open ? (
        <ArticlesForm
          minLength={minLength}
          maxLength={maxLength}
          submitLabel="File Articles of Impeachment"
          busy={filing.isPending}
          error={error}
          onSubmit={(grounds, evidence) => filing.mutate({ grounds, evidence })}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </Panel>
  );
}

function ImpeachmentTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useCurrentUser();
  const requireAuth = useRequireAuth();
  const [error, setError] = useState<string | null>(null);

  const rules = useQuery({ queryKey: ["article-v", "rules"], queryFn: articleV.rules });
  const mine = useQuery({
    queryKey: ["article-v", "my-proceedings"],
    queryFn: articleV.myProceedings,
    enabled: isAuthenticated,
  });
  const delegations = useQuery({
    queryKey: ["article-v", "my-delegations"],
    queryFn: articleV.myDelegations,
    enabled: isAuthenticated,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["article-v"] });
  };

  const voting = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => articleV.vote(id, days),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not record that vote."),
  });

  const withdrawing = useMutation({
    mutationFn: (id: string) => articleV.withdraw(id),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not take that vote back."),
  });

  const proceedings = mine.data?.proceedings ?? [];
  const open = proceedings.filter((item) => item.status === "open");
  const closed = proceedings.filter((item) => item.status !== "open");

  // Somebody you delegate to who is not already under proceedings.
  const openLeaderIds = new Set(open.map((item) => item.leader.id));
  const impeachable = (delegations.data?.delegations ?? []).filter(
    (delegation) => delegation.isActive && !openLeaderIds.has(delegation.toUser.id),
  );

  const minLength = rules.data?.minArticleLength ?? 40;
  const maxLength = rules.data?.maxArticleLength ?? 5000;

  if (!isAuthenticated) {
    return (
      <Nothing title="Impeachment belongs to the people who lent the power">
        <p>
          Only somebody currently delegating their vote to a person can move to take it back, and
          only the people who were delegating when proceedings opened can vote on it.
        </p>
        <button
          onClick={() => requireAuth("Sign in to take part in Article V proceedings.")}
          className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          Sign in
        </button>
      </Nothing>
    );
  }

  return (
    <div data-testid="impeachment-tab">
      {error ? (
        <p className="mb-3 rounded-xl border border-red-700/50 bg-red-900/25 p-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      <Panel>
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm leading-6 text-slate-300">
            <p className="font-semibold text-white">What impeachment does</p>
            <p className="mt-1 text-slate-400">
              It suspends one person from <strong>receiving</strong> delegated votes, and nothing
              else. Their account stays open, they keep their followers, they can still post and
              comment and share, and they keep their own vote — including delegating it to
              somebody else. Power here is borrowed; this calls in the loan.
            </p>
            {rules.data ? (
              <p className="mt-2 text-slate-500">
                {Math.round(rules.data.threshold * 100)}% of the people delegating to them when
                proceedings opened, within {rules.data.windowDays} days.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      {mine.isLoading ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading proceedings…</p>
      ) : null}

      {!mine.isLoading && open.length === 0 ? (
        <Nothing title="No proceedings are open that you can vote in">
          <p>
            You are shown a vote here when somebody files Articles of Impeachment against a person
            you were delegating to at that moment. Nobody who delegates after a filing gets a
            vote — that is what stops a proceeding being swung by whoever turns up once it
            starts.
          </p>
        </Nothing>
      ) : null}

      {open.map((proceeding) => (
        <ProceedingCard
          key={proceeding.id}
          proceeding={proceeding}
          busy={voting.isPending || withdrawing.isPending}
          onVote={(id, days) => voting.mutate({ id, days })}
          onWithdraw={(id) => withdrawing.mutate(id)}
        />
      ))}

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Bring proceedings
      </h2>

      {impeachable.length === 0 ? (
        <Nothing title="You are not delegating to anybody">
          <p>
            Impeachment recalls borrowed power, so it belongs to the people who lent it. Delegate
            your vote to somebody and you can also take it back — instantly and alone at any
            time, or through Article V when you think everybody who lent to them should decide
            together.
          </p>
        </Nothing>
      ) : (
        impeachable.map((delegation) => (
          <FileAgainstDelegate
            key={delegation.id}
            delegation={delegation}
            minLength={minLength}
            maxLength={maxLength}
            onFiled={refresh}
          />
        ))
      )}

      {closed.length > 0 ? (
        <>
          <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Decided
          </h2>
          {closed.map((proceeding) => (
            <ProceedingCard
              key={proceeding.id}
              proceeding={proceeding}
              busy={false}
              onVote={() => undefined}
              onWithdraw={() => undefined}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System-Wide Reset
// ---------------------------------------------------------------------------

/**
 * FULL DISCLOSURE, shown before any reset vote can be cast.
 *
 * The same three lists the 48-hour notice sends, served from one constant on
 * the backend. A vote to wipe the platform cast without knowing what gets
 * wiped is not consent, so this is never collapsed and never behind a link.
 */
function Disclosure({ disclosure }: { disclosure: SystemResetState["disclosure"] }) {
  return (
    <Panel tone="danger" className="mb-4">
      <div data-testid="reset-disclosure">
        <p className="font-semibold text-red-100">What a reset does</p>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-red-300/70">
          What everybody loses
        </p>
        <ul className="mt-1 space-y-1.5 text-sm leading-6 text-red-100/90">
          {disclosure.lost.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-emerald-300/70">
          What you keep
        </p>
        <ul className="mt-1 space-y-1.5 text-sm leading-6 text-slate-200">
          {disclosure.kept.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>

        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Afterwards
        </p>
        <ul className="mt-1 space-y-1.5 text-sm leading-6 text-slate-300">
          {disclosure.afterwards.map((line) => (
            <li key={line}>• {line}</li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function ResetTab() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useCurrentUser();
  const requireAuth = useRequireAuth();
  const [error, setError] = useState<string | null>(null);
  const [filing, setFiling] = useState(false);

  const state = useQuery({ queryKey: ["article-v", "reset"], queryFn: articleV.reset });
  const restorable = useQuery({
    queryKey: ["article-v", "restorable"],
    queryFn: articleV.restorable,
    enabled: isAuthenticated,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["article-v"] });
  };

  const balloting = useMutation({
    mutationFn: ({ id, support }: { id: string; support: boolean }) =>
      articleV.voteReset(id, support),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not record that vote."),
  });

  const opening = useMutation({
    mutationFn: ({ grounds, evidence }: { grounds: string; evidence: string }) =>
      articleV.fileReset(grounds, evidence),
    onSuccess: () => {
      setFiling(false);
      setError(null);
      refresh();
    },
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not file."),
  });

  const restoring = useMutation({
    mutationFn: () => articleV.restoreMine(),
    onSuccess: () => refresh(),
    onError: (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not restore your positions."),
  });

  const proceeding = state.data?.proceeding ?? null;
  const rules = state.data?.rules;

  const summary = useMemo(() => {
    if (!proceeding) return null;
    return {
      participation: Math.round(proceeding.participation * 100),
      approval: Math.round(proceeding.approval * 100),
    };
  }, [proceeding]);

  if (state.isLoading) {
    return <p className="py-6 text-center text-sm text-slate-500">Loading…</p>;
  }

  if (!state.data) {
    // The server did not answer. Say that, rather than an empty state that
    // looks identical to "nothing is happening".
    return (
      <Nothing title="Could not reach the platform">
        <p>Article V could not be loaded. This is a connection problem, not an empty result.</p>
      </Nothing>
    );
  }

  return (
    <div data-testid="reset-tab">
      {error ? (
        <p className="mb-3 rounded-xl border border-red-700/50 bg-red-900/25 p-3 text-sm text-red-200">
          {error}
        </p>
      ) : null}

      {/* DISCLOSURE FIRST, ALWAYS. Before the numbers, before the buttons. */}
      <Disclosure disclosure={state.data.disclosure} />

      {proceeding ? (
        <Panel tone="danger">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-white">System-Wide Reset</p>
              <p className="text-sm text-slate-400">
                Filed by {personLabel(proceeding.filedBy)}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
              {proceeding.status === "voting"
                ? `${daysLeft(proceeding.expiresAt)} days left`
                : proceeding.status === "scheduled"
                  ? `Runs in ${hoursLeft(proceeding.executeAfter ?? proceeding.expiresAt)} hours`
                  : proceeding.status}
            </span>
          </div>

          <Articles grounds={proceeding.grounds} evidence={proceeding.evidence} />

          <div className="mt-4 grid grid-cols-3 gap-2 border-y border-slate-700/50 py-3 text-center">
            <div>
              <p className="text-xs text-slate-400">For</p>
              <p className="font-semibold text-red-300">{proceeding.support}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Against</p>
              <p className="font-semibold text-emerald-300">{proceeding.oppose}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Eligible</p>
              <p className="font-semibold text-white">{proceeding.eligibleCount}</p>
            </div>
          </div>

          {rules && summary ? (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">
                  Turnout — {Math.round(rules.participationFloor * 100)}% needed
                </span>
                <span
                  className={cn(
                    "font-medium",
                    summary.participation >= rules.participationFloor * 100
                      ? "text-emerald-300"
                      : "text-slate-300",
                  )}
                >
                  {summary.participation}%
                </span>
              </div>
              <Bar
                value={proceeding.turnout}
                max={Math.max(1, Math.ceil(proceeding.eligibleCount * rules.participationFloor))}
                tone="amber"
              />
              <div className="flex justify-between pt-1">
                <span className="text-slate-400">
                  Approval — {Math.round(rules.approvalThreshold * 100)}% of those who voted
                </span>
                <span
                  className={cn(
                    "font-medium",
                    summary.approval >= rules.approvalThreshold * 100
                      ? "text-emerald-300"
                      : "text-slate-300",
                  )}
                >
                  {proceeding.turnout > 0 ? `${summary.approval}%` : "no votes yet"}
                </span>
              </div>
              <Bar
                value={proceeding.support}
                max={Math.max(1, Math.ceil(proceeding.turnout * rules.approvalThreshold))}
                tone="red"
              />
            </div>
          ) : null}

          {proceeding.status === "scheduled" ? (
            <p className="mt-4 rounded-xl border border-red-700/50 bg-red-950/50 p-3 text-sm leading-6 text-red-100">
              The vote passed. Everything above happens in{" "}
              {hoursLeft(proceeding.executeAfter ?? proceeding.expiresAt)} hours. Nothing has
              changed yet — the delay exists so nobody loses their delegations to a vote that
              closed while they slept.
            </p>
          ) : null}

          {proceeding.status === "voting" ? (
            proceeding.viewerHasVoted ? (
              <p className="mt-4 rounded-xl bg-slate-700/40 p-3 text-sm text-slate-200">
                You voted {proceeding.viewerSupported ? "for" : "against"} the reset.
              </p>
            ) : (
              <div className="mt-4 flex gap-2">
                <button
                  data-testid="reset-vote-for"
                  disabled={balloting.isPending}
                  onClick={() => {
                    if (!requireAuth("Sign in to vote on the reset.")) return;
                    balloting.mutate({ id: proceeding.id, support: true });
                  }}
                  className="flex-1 rounded-xl bg-red-600/80 py-3 font-semibold text-white hover:bg-red-600 disabled:bg-slate-700/50"
                >
                  Vote for the reset
                </button>
                <button
                  data-testid="reset-vote-against"
                  disabled={balloting.isPending}
                  onClick={() => {
                    if (!requireAuth("Sign in to vote on the reset.")) return;
                    balloting.mutate({ id: proceeding.id, support: false });
                  }}
                  className="flex-1 rounded-xl border border-slate-600 py-3 font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                >
                  Vote against
                </button>
              </div>
            )
          ) : null}
        </Panel>
      ) : (
        <Nothing title="No System-Wide Reset is before the platform">
          <p>
            Any verified account can bring one, and only one can stand at a time. It runs for{" "}
            {rules?.windowDays ?? 14} days, every account is notified, and it passes only if more
            than {Math.round((rules?.participationFloor ?? 0.5) * 100)}% of the platform votes and
            at least {Math.round((rules?.approvalThreshold ?? 0.66) * 100)}% of those votes are in
            favour. If it passes, it runs {rules?.disclosureHours ?? 48} hours later — not
            immediately.
          </p>
        </Nothing>
      )}

      {/* Putting your own voice back, offered only when there is something to put back. */}
      {restorable.data?.reset && restorable.data.available > 0 ? (
        <Panel>
          <p className="font-semibold text-white">Put your own positions back</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            The last reset cleared {restorable.data.available} position
            {restorable.data.available === 1 ? "" : "s"} you had taken yourself. Only what you
            cast personally — nothing a delegate cast in your name, because that was never stored
            as yours.
          </p>
          <button
            data-testid="restore-my-positions"
            disabled={restoring.isPending}
            onClick={() => restoring.mutate()}
            className="mt-3 w-full rounded-xl bg-slate-700 py-3 font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {restoring.isPending ? "Restoring…" : "Restore my positions"}
          </button>
        </Panel>
      ) : null}

      {!proceeding && isAuthenticated ? (
        <Panel>
          {!filing ? (
            <button
              data-testid="open-reset-form"
              onClick={() => setFiling(true)}
              className="w-full rounded-xl border border-red-700/50 py-3 text-sm font-medium text-red-300 hover:bg-red-900/30"
            >
              File Articles of System Reset
            </button>
          ) : (
            <ArticlesForm
              minLength={rules?.minArticleLength ?? 40}
              maxLength={rules?.maxArticleLength ?? 5000}
              submitLabel="File Articles of System Reset"
              busy={opening.isPending}
              error={null}
              onSubmit={(grounds, evidence) => opening.mutate({ grounds, evidence })}
              onCancel={() => setFiling(false)}
            />
          )}
        </Panel>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ArticleV() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"impeachment" | "reset">("impeachment");

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl py-4">
        <div className="mb-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
            className="-ml-2 text-muted-foreground"
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <div className="text-center">
            <span className="block font-bold text-white">Article V</span>
            <span className="block text-xs text-slate-400">Self-Correction</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/constitution")}
            className="text-muted-foreground"
            aria-label="Open Constitution"
          >
            <BookOpen className="h-5 w-5" />
          </Button>
        </div>

        <div className="mb-6 overflow-hidden rounded-2xl border border-red-700/30 bg-gradient-to-br from-[#7F1D1D] to-[#450A0A] p-5">
          <div className="mb-3 flex items-center">
            <div className="mr-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20">
              <RotateCcw size={24} color="#FCA5A5" />
            </div>
            <div className="flex-1">
              <span className="block text-xl font-bold text-red-100">Self-Correction</span>
              <span className="block text-sm text-red-300/70">Constitutional Article V</span>
            </div>
          </div>
          <p className="italic leading-6 text-red-200/80">
            "The community retains the right to Impeach or demote any leader who misrepresents
            facts or violates the Code of Conduct, and may trigger a System-Wide Reset via
            super-majority vote."
          </p>
        </div>

        <div className="mb-6 flex">
          <button
            data-testid="tab-impeachment"
            onClick={() => setTab("impeachment")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-l-xl border py-3 transition-colors",
              tab === "impeachment"
                ? "border-amber-500/50 bg-amber-500/20 text-amber-200"
                : "border-slate-700/50 bg-slate-800/40 text-slate-400",
            )}
          >
            <Users size={16} />
            Impeachment
          </button>
          <button
            data-testid="tab-reset"
            onClick={() => setTab("reset")}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-r-xl border border-l-0 py-3 transition-colors",
              tab === "reset"
                ? "border-red-500/50 bg-red-500/20 text-red-200"
                : "border-slate-700/50 bg-slate-800/40 text-slate-400",
            )}
          >
            <AlertTriangle size={16} />
            System Reset
          </button>
        </div>

        {tab === "impeachment" ? <ImpeachmentTab /> : <ResetTab />}

        <p className="mt-8 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <FileText className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Both filings are formal documents. They go to the platform's administrators, and the
            person named in Articles of Impeachment is sent a copy. Nobody — no administrator, no
            owner, not the person accused — can stop a proceeding once it has started. A filing
            made in bad faith is grounds for suspending or banning whoever made it, and the
            proceeding still runs.
          </span>
        </p>

        <p className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <Clock className="h-3.5 w-3.5" />
          Every number on this page is counted from real proceedings. Nothing here is a sample.
        </p>
      </div>
    </AppShell>
  );
}
