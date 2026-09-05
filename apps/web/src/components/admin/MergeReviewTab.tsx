// Two records that might be one law, waiting for somebody to say yes or no.
//
// This screen exists because the system deliberately refuses to guess. Only
// congress.gov's "Identical bill" — a Library of Congress analyst confirming two
// texts match — is acted on automatically, and by the time such a pair appears
// here it is already merged and marked approved. Everything else is a question,
// and the answer is destructive: approving rewrites which record every affected
// post and vote belongs to.
//
// So the screen's job is to make the question answerable. Every card carries
// what the government called the relationship, who assigned it, a link to the
// page a reviewer can read for themselves, and what each record would cost to
// fold away — its posts, its real votes, whether it already has a brief.
//
// Look-alikes are this platform's own title guesses. They carry no source and no
// analyst, and the card says so in as many words. They exist because 7 of 13
// stored bills have no published lineage at all.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CircleCheck,
  CircleX,
  ExternalLink,
  GitMerge,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface MergeSide {
  id: string;
  masterReferenceId: string;
  displayId: string;
  referenceType: string;
  title: string;
  status: string;
  congress: number | null;
  sourceUrl: string | null;
  votes: { support: number; oppose: number };
  posts: number;
  realVotes: number;
  hasBrief: boolean;
  createdAt: string;
  /** Executive orders only. The day the President signed it. */
  signedDate: string | null;
  /** "pending" while an executive order is still waiting on its number. */
  numberStatus: string | null;
  /** The text, normalised and hashed. Two sides that match are one document. */
  textFingerprint: string | null;
}

interface MergeCandidate {
  id: string;
  relationship: string;
  identifiedBy: string | null;
  evidenceUrl: string | null;
  similarity: number | null;
  isSuggestion: boolean;
  status: string;
  note: string | null;
  decidedAt: string | null;
  createdAt: string;
  left: MergeSide;
  right: MergeSide;
}

/** Plain-language gloss on the government's own label. */
const RELATIONSHIP_MEANING: Record<string, string> = {
  "Identical bill": "The Library of Congress confirmed both texts match.",
  "Companion measure": "Filed in the other chamber to move in parallel.",
  "Procedurally-related": "Linked by a rule or a motion, not by their text.",
  look_alike:
    "A title match this platform noticed. No source, no analyst — a suggestion only.",
  /*
   * Two executive orders claiming one order number. There is no government
   * lineage to lean on here — nobody publishes relationships between
   * presidential documents — so the card below shows the evidence that does
   * exist: signing dates, title overlap, and whether the two texts are the
   * same document.
   */
  same_executive_order_number:
    "Both records claim the same Federal Register order number. One of them is wrong, or they are one order held twice.",
  same_executive_order:
    "One executive order, held twice — read from the White House the day it was signed and again from the Federal Register.",
};

export function MergeReviewTab() {
  const queryClient = useQueryClient();
  const [showDecided, setShowDecided] = useState(false);
  const [rejecting, setRejecting] = useState<MergeCandidate | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "reference-merges", showDecided ? "all" : "pending"],
    queryFn: () =>
      api.get<{ candidates: MergeCandidate[] }>(
        `/api/admin/reference-merges?status=${showDecided ? "all" : "pending"}`,
        { headers: adminAuthHeader() },
      ),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin", "reference-merges"] });

  const approve = useMutation({
    mutationFn: ({ id, keepId }: { id: string; keepId: string }) =>
      api.post<{ merge: { target: { masterReferenceId: string }; postsMoved: number; votesMoved: number } }>(
        `/api/admin/reference-merges/${id}/approve`,
        { keepId },
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => {
      toast.success(
        `Merged into ${response.merge.target.masterReferenceId} — ` +
          `${response.merge.postsMoved} post(s), ${response.merge.votesMoved} vote(s) moved.`,
      );
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not merge these records"),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<{ success: boolean }>(
        `/api/admin/reference-merges/${id}/reject`,
        reason ? { note: reason } : {},
        { headers: adminAuthHeader() },
      ),
    onSuccess: () => {
      setRejecting(null);
      setNote("");
      toast.success("Recorded. This pair will not be raised again.");
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Could not record that"),
  });

  const recheck = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>(
        "/api/admin/reference-merges/refresh",
        {},
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => toast.success(response.message),
    onError: (e: Error) => toast.error(e.message || "Could not start the check"),
  });

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        Could not load the review queue. {(error as Error).message}
      </div>
    );
  }

  const candidates = data?.candidates ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <GitMerge className="h-5 w-5" />
            Records that might be one law
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Congress files the same law twice as a matter of routine. Until two records are
            joined, the country's opinion on that law is split across two counts. Pairs the
            Library of Congress has confirmed identical are already merged; these are the ones
            that need a person.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowDecided((v) => !v)}>
            {showDecided ? "Pending only" : "Show decided"}
          </Button>
          <Button
            variant="outline"
            onClick={() => recheck.mutate()}
            disabled={recheck.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${recheck.isPending ? "animate-spin" : ""}`} />
            Check congress.gov
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing waiting. Every pair the government has published a relationship for has been
          answered.
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              busy={approve.isPending || reject.isPending}
              onKeep={(keepId) => approve.mutate({ id: candidate.id, keepId })}
              onReject={() => {
                setRejecting(candidate);
                setNote("");
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={Boolean(rejecting)} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>These are two different laws</DialogTitle>
            <DialogDescription>
              This pair will not be raised again. A note here is what stops somebody
              re-litigating it in six months — say what made them different.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Same subject, different appropriations year."
            rows={3}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => rejecting && reject.mutate({ id: rejecting.id, reason: note.trim() })}
              disabled={reject.isPending}
            >
              Record it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CandidateCard({
  candidate,
  busy,
  onKeep,
  onReject,
}: {
  candidate: MergeCandidate;
  busy: boolean;
  onKeep: (keepId: string) => void;
  onReject: () => void;
}) {
  const meaning = RELATIONSHIP_MEANING[candidate.relationship];
  const decided = candidate.status !== "pending";
  /*
   * Null when either side has no stored text — which is a different thing from
   * the texts differing, and must not be shown as if it were.
   */
  const sameDocument =
    candidate.left.textFingerprint && candidate.right.textFingerprint
      ? candidate.left.textFingerprint === candidate.right.textFingerprint
      : null;

  return (
    <div
      className={`rounded-lg border p-4 ${
        candidate.isSuggestion ? "border-dashed bg-muted/30" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {candidate.isSuggestion ? (
              <Badge variant="outline" className="gap-1">
                <Lightbulb className="h-3 w-3" />
                Suggestion only
              </Badge>
            ) : (
              <Badge className="gap-1 bg-blue-500/20 text-blue-600 hover:bg-blue-500/20">
                <ShieldCheck className="h-3 w-3" />
                {candidate.relationship}
              </Badge>
            )}
            {/* Who assigned it. Its absence on a suggestion is the whole point. */}
            {candidate.identifiedBy ? (
              <span className="text-xs text-muted-foreground">
                identified by {candidate.identifiedBy}
              </span>
            ) : null}
            {candidate.similarity !== null ? (
              <span className="text-xs text-muted-foreground">
                {Math.round(candidate.similarity * 100)}% title overlap
              </span>
            ) : null}
            {decided ? (
              <Badge variant="secondary" className="capitalize">
                {candidate.status}
              </Badge>
            ) : null}
          </div>
          {meaning ? <p className="text-sm text-muted-foreground">{meaning}</p> : null}
          {/*
            THE EVIDENCE AVAILABLE WHEN THE GOVERNMENT PUBLISHES NONE.
            Identical text is proof; different text is not proof of the
            opposite, so it is stated as a fact rather than as a verdict.
          */}
          {sameDocument !== null ? (
            <p
              className={`text-xs ${sameDocument ? "text-emerald-500" : "text-muted-foreground"}`}
            >
              {sameDocument
                ? "The two stored texts are the same document, character for character once formatting is normalised."
                : "The two stored texts are not identical."}
            </p>
          ) : null}
          {candidate.left.signedDate || candidate.right.signedDate ? (
            <p className="text-xs text-muted-foreground">
              Signed {candidate.left.signedDate ?? "unknown"}
              {candidate.left.signedDate === candidate.right.signedDate
                ? " — both on the same day"
                : ` and ${candidate.right.signedDate ?? "unknown"}`}
            </p>
          ) : null}
          {candidate.note ? (
            <p className="text-sm italic text-muted-foreground">{candidate.note}</p>
          ) : null}
        </div>

        {candidate.evidenceUrl ? (
          <a
            href={candidate.evidenceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Read it on congress.gov
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <SideCard side={candidate.left} />
        <SideCard side={candidate.right} />
      </div>

      {!decided ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {/*
            Which record survives is the reviewer's call, not the system's: they
            can see which one carries the posts and the votes. Both directions
            are offered explicitly rather than hidden behind a default.
          */}
          <Button size="sm" disabled={busy} onClick={() => onKeep(candidate.left.id)}>
            <CircleCheck className="mr-2 h-4 w-4" />
            Keep {candidate.left.displayId}
            <ArrowRight className="mx-1 h-3.5 w-3.5" />
            <span className="opacity-70">fold in {candidate.right.displayId}</span>
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onKeep(candidate.right.id)}>
            <CircleCheck className="mr-2 h-4 w-4" />
            Keep {candidate.right.displayId}
            <ArrowRight className="mx-1 h-3.5 w-3.5" />
            <span className="opacity-70">fold in {candidate.left.displayId}</span>
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onReject}>
            <CircleX className="mr-2 h-4 w-4" />
            Different laws
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** What one record would cost to fold away. */
function SideCard({ side }: { side: MergeSide }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold">{side.displayId}</span>
        <span className="text-xs capitalize text-muted-foreground">{side.status}</span>
      </div>
      {side.numberStatus === "pending" ? (
        <p className="mt-1 text-xs text-amber-500">
          Waiting on its order number from the Federal Register.
        </p>
      ) : null}
      <p className="mt-1 line-clamp-2 text-sm">{side.title}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{side.posts} post{side.posts === 1 ? "" : "s"}</span>
        <span>
          {side.realVotes} real vote{side.realVotes === 1 ? "" : "s"}
        </span>
        <span>
          {side.votes.support.toLocaleString()} for / {side.votes.oppose.toLocaleString()} against
        </span>
        {side.hasBrief ? <span>has a brief</span> : null}
      </div>
      {side.sourceUrl ? (
        <a
          href={side.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Official page
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}
