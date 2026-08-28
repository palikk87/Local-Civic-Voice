import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ExternalLink,
  Building2,
  CalendarDays,
  Hash,
  MessageSquare,
  Share2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { VotePanel } from "@/components/civic/VotePanel";
import { IntegrityAuditPanel } from "@/components/audit/IntegrityAuditPanel";
import { OtherSide } from "@/components/civic/OtherSide";
import { PulseHistory } from "@/components/civic/PulseHistory";
import { TurningPoints } from "@/components/civic/TurningPoints";
import { CommentThread } from "@/components/feed/CommentThread";
import {
  ReferenceTypeBadge,
  CategoryBadge,
  StatusBadge,
} from "@/components/civic/badges";
import { civicApi, formatDate, ordinal, titleCase } from "@/lib/civic";
import { CitizensBriefCard } from "@/components/civic/CitizensBriefCard";
import { useCitizenBrief } from "@/hooks/use-citizen-brief";

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Hash;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </span>
      <span className="text-right text-sm font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export default function ReferenceDetail() {
  const navigate = useNavigate();
  const { id = "" } = useParams();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["reference", id],
    queryFn: () => civicApi.getReference(id),
    enabled: !!id,
  });

  const reference = data?.reference;

  // The brief is asked for, not started by opening the page. Seeded with
  // whatever the record already holds, so a law somebody has already asked
  // about shows its brief immediately and costs nothing.
  const citizenBrief = useCitizenBrief(reference?.id, {
    initialBrief: reference?.citizenBriefSections ?? null,
    initialState: reference?.briefState ?? "idle",
  });

  // A brief written for an earlier text of this law. Worth reading and worth
  // labelling; both numbers come from the server.
  const briefIsStale =
    !!reference?.citizenBriefSections &&
    reference.citizenBriefVersion !== reference.lawVersion;

  return (
    <AppShell wide>
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* BACK MEANS BACK. This said "Back to Explore" and went to /explore
            no matter where the reader came from — the feed, their timeline, a
            search, a link somebody sent them, their own record. Most people
            arriving here have never seen Explore, and the button took them
            somewhere they had not been. The browser already knows. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-6 -ml-2"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back
        </Button>

        {isLoading ? (
          <div className="grid gap-8 xl:grid-cols-[1.6fr_1fr]">
            <div className="space-y-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
            <Skeleton className="h-96 w-full rounded-2xl" />
          </div>
        ) : isError || !reference ? (
          <div className="rounded-xl border border-dashed border-border py-20 text-center">
            <p className="font-display text-lg text-foreground">
              We couldn't load this reference
            </p>
            <Button variant="outline" asChild className="mt-4">
              <Link to="/explore">Return to Explore</Link>
            </Button>
          </div>
        ) : (
          // Three columns only from xl.
          //
          // Between lg and xl the sidebar, the article and this aside stopped
          // fitting: measured at 1097px the document was 1109px wide, the
          // aside's right edge sat past the viewport, and the Support and
          // Oppose buttons overlapped by 13px with Oppose clipped off the
          // screen. Below xl the aside now stacks under the article, which is
          // the same thing it already did below lg.
          <div className="grid gap-8 xl:grid-cols-[1.6fr_1fr] xl:items-start">
            {/* Main column */}
            <article>
              <div className="flex flex-wrap items-center gap-3">
                <ReferenceTypeBadge type={reference.referenceType} />
                <CategoryBadge category={reference.category} />
                <StatusBadge status={reference.status} />
              </div>

              <h1 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground text-balance sm:text-4xl">
                {reference.title}
              </h1>
              {reference.shortTitle ? (
                <p className="mt-2 text-lg text-muted-foreground">
                  {reference.shortTitle}
                </p>
              ) : null}

              <div className="mt-4 flex items-center gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4" />
                  {reference.engagement.comments} comments
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Share2 className="h-4 w-4" />
                  {reference.engagement.shares} shares
                </span>
              </div>

              <Separator className="my-6" />

              <CitizensBriefCard
                state={citizenBrief.state}
                brief={citizenBrief.brief}
                reason={citizenBrief.reason}
                isRequesting={citizenBrief.isRequesting}
                onRequest={citizenBrief.request}
                onRewrite={citizenBrief.brief ? citizenBrief.rewrite : undefined}
                isStale={briefIsStale}
                sourceUrl={reference.fullTextUrl ?? reference.sourceUrl}
                sourceLabel="View the official text"
                emptyDescription={`A plain-English summary of ${reference.displayId}, written from its complete official text`}
              />

              {reference.description ? (
                <div className="mt-8">
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    Summary
                  </h2>
                  <p className="mt-3 leading-relaxed text-foreground/90">
                    {reference.description}
                  </p>
                </div>
              ) : null}

              {reference.fullText ? (
                <div className="mt-8">
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    Full text
                  </h2>
                  <div className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-5 font-mono text-sm leading-relaxed text-foreground/80">
                    {reference.fullText}
                  </div>
                </div>
              ) : null}

              {reference.aliases?.length ? (
                <div className="mt-8">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Also known as
                  </h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reference.aliases.map((alias) => (
                      <span
                        key={alias}
                        className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                      >
                        {alias}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Metadata */}
              <div className="mt-8 rounded-xl border border-border bg-card p-5">
                <h3 className="font-display text-base font-semibold text-foreground">
                  Official record
                </h3>
                <div className="mt-2 divide-y divide-border/60">
                  <MetaRow icon={Hash} label="Master reference ID" value={reference.masterReferenceId} />
                  {reference.chamber ? (
                    <MetaRow icon={Building2} label="Chamber" value={titleCase(reference.chamber)} />
                  ) : null}
                  {/* The suffix was hardcoded "th". Correct today, wrong from
                      the 121st Congress on — four years away. */}
                  {reference.congress ? (
                    <MetaRow icon={Building2} label="Congress" value={ordinal(reference.congress)} />
                  ) : null}
                  {reference.signedDate ? (
                    <MetaRow icon={CalendarDays} label="Signed" value={formatDate(reference.signedDate) ?? ""} />
                  ) : null}
                  {reference.decidedDate ? (
                    <MetaRow icon={CalendarDays} label="Decided" value={formatDate(reference.decidedDate) ?? ""} />
                  ) : null}
                </div>
                {reference.sourceUrl ? (
                  <Button variant="outline" size="sm" asChild className="mt-4">
                    <a href={reference.sourceUrl} target="_blank" rel="noreferrer">
                      View official source <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </article>

            {/* Vote sidebar */}
            <aside className="xl:sticky xl:top-20">
              <VotePanel reference={reference} />

              {/* Only this platform can do either of these: every post is
                  attached to a government record, and every position on that
                  record is known. */}
              <PulseHistory referenceId={reference.id} />
              <TurningPoints referenceId={reference.id} />
              <OtherSide referenceId={reference.id} />

              {/* ARTICLE III §2. The tally above is the platform's claim; this
                  is where anybody can make it prove itself. */}
              <div className="mt-4">
                <IntegrityAuditPanel
                  subjectType="reference"
                  subjectId={reference.id}
                  title="Integrity Audit of this vote"
                  what="the votes on this record, as totals and timings"
                />
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
