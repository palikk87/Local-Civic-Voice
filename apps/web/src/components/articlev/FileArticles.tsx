/**
 * Filing Articles of Impeachment, from wherever the person is.
 *
 * WHY THIS IS ITS OWN FILE. It used to live inside the Article V page, which
 * meant the only way to bring proceedings was to find a card buried on your own
 * profile, open Article V, and scroll to a list of your delegates. Somebody who
 * has just watched a delegate do the thing they want to impeach them for is
 * looking at THAT PERSON, not at a constitutional page they have never opened.
 * A remedy nobody can find is not a remedy, so the form goes where the person
 * is — their profile — and Article V, from one implementation.
 *
 * The bar is unchanged and enforced by the server either way: only somebody
 * currently delegating to this person may file.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { articleV, personLabel, type MyDelegation } from "@/lib/article-v";

export function ArticlesForm({
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

export function FileAgainstDelegate({
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
    <div className="mb-4 rounded-2xl border border-slate-700/50 bg-slate-800/60 p-4">
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
    </div>
  );
}
