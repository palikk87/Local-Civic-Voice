import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Post } from "@/lib/civic";
import {
  ArrowLeft,
  ExternalLink,
  Building2,
  CalendarDays,
  Clock,
  Hash,
  Link2,
  MessageSquare,
  Scale,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { VotePanel } from "@/components/civic/VotePanel";
import { IntegrityAuditPanel } from "@/components/audit/IntegrityAuditPanel";
import { PageMeta } from "@/components/civic/PageMeta";
import { recordUrl } from "@/lib/record-url";
import { OtherSide } from "@/components/civic/OtherSide";
import { PulseHistory } from "@/components/civic/PulseHistory";
import { TurningPoints } from "@/components/civic/TurningPoints";
import { PostCard } from "@/components/feed/PostCard";
import { ComposeDialog } from "@/components/messages/ComposeDialog";
import {
  ReferenceTypeBadge,
  CategoryBadge,
  StatusBadge,
} from "@/components/civic/badges";
import { civicApi, formatDate, ordinal, titleCase, type ReferenceType } from "@/lib/civic";
import { CitizensBriefCard } from "@/components/civic/CitizensBriefCard";
import { RepresentationGapPanel } from "@/components/civic/RepresentationGapPanel";
import { ShareToTimeline, type ShareBranch } from "@/components/civic/ShareToTimeline";
import { useCitizenBrief } from "@/hooks/use-citizen-brief";
import { useIsWide } from "@/hooks/use-is-wide";
import { useLoadOrder } from "@/hooks/use-load-order";
import { memberPhotoUrl } from "@/lib/member-photo";
import { RecordBadge } from "@/components/civic/RecordBadge";

/**
 * Send this law to one person.
 *
 * "Share to your timeline" puts it in front of everybody; this puts it in front
 * of somebody. Both were asked for and only the first existed — the record page
 * had no way to reach one person at all, which is the thing you most want at
 * the moment you have just read a law and thought of who needs to see it.
 *
 * It writes the draft and picks nobody. The message is not sent; the composer
 * opens with the link in the box, and the reader chooses the person and presses
 * send themselves.
 */
function SendToSomeone({ reference }: { reference: { id: string; title: string } }) {
  const [open, setOpen] = useState(false);
  const link = `${window.location.origin}/reference/${reference.id}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Send ${reference.title} to someone`}
        className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-accent/15"
      >
        <Send className="h-4 w-4" />
        Send to someone
      </button>
      <ComposeDialog open={open} onOpenChange={setOpen} draft={`${reference.title}\n${link}`} />
    </>
  );
}

/**
 * THE CONVERSATION THIS PAGE HAD BEEN ADVERTISING.
 *
 * The record page printed a comment count and offered no way to join — no like,
 * no reply, nothing. The lightweight feed card had all three. So the page where
 * somebody has actually read the law, read the brief and taken a position was
 * the one place they could not say anything about it, which is the loop
 * breaking at its most valuable moment.
 *
 * CommentThread was imported at the top of this file and never rendered, which
 * is the shape of the original intent: the section was planned and never built.
 * It could not have been, either — GET /:id/posts returned a payload the app's
 * own Post type cannot satisfy, with no reference fields and no isLiked, so a
 * card rendered from it would have had a like button that could not know
 * whether you had liked it. That endpoint now returns the feed's shape.
 *
 * These are POSTS ABOUT THE LAW, not comments on the law. That is the real
 * model — a law is not a thing you reply to, it is a thing people write about —
 * and every post here carries its own replies and likes, which is where the
 * count on this page comes from.
 */
function Conversation({ referenceId, ready }: { referenceId: string; ready: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reference-posts", referenceId],
    queryFn: () => api.get<{ posts: Post[] }>(`/api/government-references/${referenceId}/posts`),
    enabled: ready,
  });

  const posts = data?.posts ?? [];

  return (
    <section id="conversation" className="mt-8 scroll-mt-20">
      <h2 className="mb-1 text-lg font-bold text-foreground">What people are saying</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Posts about this law. Reply to one, or share the law to My Voice to start your own.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      ) : posts.length === 0 ? (
        /* An honest empty state. Nobody has written about this yet, and saying
           so is a finished feature — the invitation is the share button above. */
        <div className="rounded-2xl border border-border bg-secondary/30 p-6 text-center">
          <MessageSquare className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nobody has written about this one yet. Share it to My Voice and you will be first.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </section>
  );
}

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

/** A record's branch, in the vocabulary the share sheet speaks. */
const BRANCH_OF: Record<ReferenceType, ShareBranch> = {
  bill: "legislative",
  executive_order: "executive",
  scotus_case: "judicial",
};

export default function ReferenceDetail() {
  const navigate = useNavigate();
  const { id = "" } = useParams();
  // Where the vote panel belongs. See the comment at its mobile position.
  const isWide = useIsWide();

  /**
   * TEN REQUESTS, ASKED FOR IN THE ORDER YOU MEET THEM.
   *
   * Opening a law fired all ten at once — the record, the vote tally, the
   * conversation, the representation gap, the pulse history, the turning
   * points, the other side, the integrity audit, the session, the
   * notifications. Five of those paint panels 1,500px down the page, and the
   * browser opened them before it had finished painting the top of the screen.
   * The brief a reader came for landed at about four seconds, queued behind
   * things they had not scrolled to.
   *
   * NOTHING IS DROPPED. All ten still run on every visit, unconditionally. The
   * instruction was exactly this: "keep all the requests but prioritize the
   * requests from top to bottom of the page." Deferring to a scroll would mean
   * fewer requests and a worse product — a panel that has not started loading
   * when you reach it is a spinner you wait at.
   *
   *   0  the record and the vote panel — the top of the screen
   *   1  the conversation, which is on this column and read next
   *   2  the sidebar: gap, pulse, turning points, other side, audit
   */
  const loaded = useLoadOrder(3);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["reference", id],
    queryFn: () => civicApi.getReference(id),
    enabled: !!id,
  });

  const reference = data?.reference;

  /*
   * THE BUTTON IS ALWAYS THE WAY IN, EVEN WHEN THE BRIEF IS ALREADY WRITTEN.
   *
   * This used to be seeded with whatever the record held, so a law somebody had
   * already asked about opened with its brief on the screen. That reads as the
   * page having fetched it — "anything that I open that's already on the server
   * wants to auto display the brief" — and it quietly removes the one moment
   * where a reader decides to ask.
   *
   * Khalid: "the interactive nature of clicking the button is very valuable to
   * the user experience. so whether we have the brief or not that button always
   * has to be clicked before loading."
   *
   * So the card always starts idle. Pressing the button on a law we already
   * hold a brief for returns it from the record immediately and costs nothing —
   * the server writes one only when there is none. Nobody pays twice, and
   * nobody is handed something they did not ask for.
   */
  const citizenBrief = useCitizenBrief(reference?.id);

  // WHO DECIDED THIS LAW, and the face to put beside their name.
  //
  // The server has already worked out who it is and what to call what they did,
  // for all three branches. The one thing left to the client is a member of
  // Congress's portrait, because that is a pure function of their bioguide id
  // and the URL pattern is already here for the Delegates screen — a President
  // or a Justice arrives with their photoUrl resolved.
  const attribution = reference?.attribution ?? null;
  const attributionPhoto =
    attribution?.photoUrl ?? memberPhotoUrl(attribution?.bioguideId) ?? undefined;

  // A brief written for an earlier text of this law. Worth reading and worth
  // labelling; both numbers come from the server.
  const briefIsStale =
    !!reference?.citizenBriefSections &&
    reference.citizenBriefVersion !== reference.lawVersion;

  /*
   * WHAT THIS PAGE IS, IN THE TAB AND IN A SHARED LINK.
   *
   * Every path on this site served the same title and the same description,
   * written into index.html — so a law shared to a group chat showed the site's
   * banner rather than the law's name. The title is written as the query
   * somebody would type, not as branding.
   *
   * THE CANONICAL IS ALWAYS THE BRANCH ADDRESS. This page answers on both
   * /executive-order/eo-14421 and /reference/<cuid>, because every link ever
   * shared uses the second. Naming one of them canonical is what stops the two
   * competing as duplicates.
   */
  const pageTitle = reference
    ? `${reference.displayId ? `${reference.displayId}: ` : ""}${reference.title} — AYE & NAY`
    : "Loading a record — AYE & NAY";
  const pageDescription = reference
    ? reference.citizenBriefSections?.summary ||
      reference.description ||
      `What ${reference.displayId || reference.title} does, who is behind it, and where the public stands on it.`
    : undefined;

  return (
    <AppShell wide>
      {reference ? (
        <PageMeta
          title={pageTitle}
          description={pageDescription?.slice(0, 300)}
          canonical={recordUrl(reference)}
        />
      ) : null}
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
            {/*
              min-w-0 IS LOAD-BEARING, exactly as it is on the bottom nav.

              A grid item defaults to `min-width: auto`, which means it will not
              shrink below the min-content width of what is inside it. The full
              text panel below holds raw congressional text, and that text's
              min-content width is around 640px. So on a phone this article
              refused to be narrower than 640px inside a 326px column, the
              document became 672px wide, and iOS offered the reader a page
              wider than their screen. The header bar and the page background
              are `width: 100%` — they resolve against the VIEWPORT — so they
              stopped at 390px while the article ran on past them. That is the
              misalignment in the report: chrome painted to one width, content
              laid out to another.
            */}
            <article className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <ReferenceTypeBadge type={reference.referenceType} />
                <CategoryBadge category={reference.category} />
                <StatusBadge status={reference.status} />
                {/*
                  HOW COMPLETE OUR RECORD OF THIS LAW IS. The same chip the feed
                  card carries, from the same server answer — a reader who taps
                  it on a card and then opens the law must not be told two
                  different things about our own work.
                */}
                <RecordBadge completeness={reference.completeness} title={reference.shortTitle ?? reference.title} />
              </div>

              <h1 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground text-balance sm:text-4xl">
                {reference.title}
              </h1>
              {reference.shortTitle ? (
                <p className="mt-2 text-lg text-muted-foreground">
                  {reference.shortTitle}
                </p>
              ) : null}

              {/*
                WHO DECIDED THIS, with their face.

                "The photo personifies the page, otherwise it just feels bland."
                A law is a decision somebody made, and every branch has that
                somebody: a bill has its sponsor, an executive order the
                President who signed it, a Supreme Court case the justice who
                wrote the majority. This used to render for bills only, so two
                thirds of the platform's records were a title and a status.

                The server decides who it is and what to call what they did —
                services/reference-attribution.ts — because three endpoints
                return records and they should all say the same thing.

                NOTHING RENDERS WHEN NOBODY IS KNOWN. A per curiam opinion has
                no author, and a bill the provenance pass has not reached has no
                sponsor yet. Both show no card rather than a placeholder
                standing in for a human being.
              */}
              {attribution ? (
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                  {attributionPhoto ? (
                    <img
                      src={attributionPhoto}
                      alt=""
                      className="h-11 w-11 shrink-0 rounded-full object-cover"
                      // A portrait that 404s leaves a broken-image icon, which
                      // reads as a bug rather than as a missing photograph.
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">
                      {attribution.role} {attribution.name}
                    </p>
                    {attribution.party ? (
                      <p className="text-sm text-muted-foreground">
                        {attribution.party === "D"
                          ? "Democrat"
                          : attribution.party === "R"
                            ? "Republican"
                            : "Independent"}
                        {attribution.state ? ` — ${attribution.state}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/*
                THE BENCH, for a ruling the Court issued with no author on it.

                A per curiam opinion is the Supreme Court speaking as one body.
                For decades of them this page showed a docket number and nobody
                — and the platform is about accountability, so nobody is the
                wrong answer. Every justice sitting that day is answerable for
                what the Court put out in their name.

                THE LABEL SAYS "AS IT SAT", NOT "DECIDED BY". Justices do
                dissent from per curiam rulings. Naming these nine as having
                agreed would be a claim about individuals the record does not
                support; naming them as the Court that day is simply true.
              */}
              {attribution?.panel?.length ? (
                <div className="mt-3 rounded-xl border border-border bg-card p-4">
                  <p className="text-sm text-muted-foreground">{attribution.panelLabel}</p>
                  <ul className="mt-3 flex flex-wrap gap-4">
                    {attribution.panel.map((justice) => (
                      <li key={justice.name} className="flex w-20 flex-col items-center gap-1.5">
                        {justice.photoUrl ? (
                          <img
                            src={justice.photoUrl}
                            alt=""
                            className="h-12 w-12 rounded-full object-cover"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        ) : (
                          // No portrait found yet. The initials keep the row
                          // aligned and, more to the point, keep the person on
                          // the page — dropping them would quietly shrink the
                          // bench, which is the one thing this must not do.
                          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                            {justice.name
                              .split(/\s+/)
                              .filter((part) => /^[A-Za-z]/.test(part))
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join("")}
                          </span>
                        )}
                        <span className="text-center text-xs leading-tight text-muted-foreground">
                          {justice.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/*
                DATES — from congress.gov, or absent.

                Both used to be our own row's createdAt on the old screen, so a
                statute from 2007 read "Introduced today". They come from
                provenance now, and a record that has not been reached yet
                shows neither rather than inventing one.
              */}
              {reference.introducedDate || reference.lastActionDate ? (
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  {reference.introducedDate ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-4 w-4" />
                      Introduced {formatDate(reference.introducedDate)}
                    </span>
                  ) : null}
                  {reference.lastActionDate ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-4 w-4" />
                      Last action {formatDate(reference.lastActionDate)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {reference.lastActionText ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {reference.lastActionText}
                </p>
              ) : null}

              {/*
                THERE IS NO COUNTS ROW HERE ANY MORE.

                "0 comments · 0 shares" sat on this line, in grey, directly
                above the two buttons below. Two dead numbers stacked on two
                live controls.

                The first word was also untrue. A law is not a post and owns no
                comments — what is under this page is POSTS people wrote about
                the law, each living on its author's own timeline. The owner
                caught it: "that comment in the law card is just a comment
                count, I don't like it, it's very misleading." Then, on the
                whole row: "we are on different pages" — he meant both numbers,
                not just the word.

                A count that needs a different noun to be true is worth less
                than the list sitting right under it. The conversation section
                below shows what is there; if three people have written about
                this law, you see three. The buttons do the acting. Neither
                needed a number introducing it.
              */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <ShareToTimeline
                  target={{
                    branch: BRANCH_OF[reference.referenceType],
                    title: reference.title,
                    masterReferenceId: reference.masterReferenceId,
                    sourceUrl: reference.sourceUrl ?? undefined,
                  }}
                  label="Share to My Voice"
                  className="!bg-accent !px-4 !py-2 !text-sm !font-semibold !text-slate-900 hover:!bg-accent/90 hover:!text-slate-900"
                />
                <SendToSomeone reference={reference} />

                {/*
                  A LINK ANYBODY CAN TAKE AWAY.
                  The two controls above both keep you inside the platform —
                  one posts to your own page, the other messages a member — and
                  between them there was no way to get a link to the law at all.
                  The only route out was copying the address bar, which hands
                  somebody /reference/<id> rather than the readable address.
                  So: the canonical address, not window.location, because the
                  reader may well have arrived on the id form themselves.

                  NO SIGN-IN ON THIS ONE. A law is public and its address is
                  public; the account is what "Share to My Voice" and "Send to
                  someone" need, because those write something. Copying a link
                  writes nothing.
                */}
                <button
                  type="button"
                  onClick={() => {
                    const url = recordUrl(reference);
                    void navigator.clipboard
                      ?.writeText(url)
                      .then(() => toast.success("Link copied"))
                      .catch(() => toast.error("Couldn't copy that"));
                  }}
                  aria-label={`Copy the link to ${reference.title}`}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Link2 size={14} />
                  Copy link
                </button>
              </div>

              <Separator className="my-6" />

              {/*
                THE VOTE PANEL, WHEN THE PAGE IS ONE COLUMN.

                Above xl the panel sits in the column beside this one, where it
                is visible the whole way down the page. Below xl that column
                stacks UNDERNEATH the article — after the brief, the full
                official text of a bill, and everything else — so on a phone the
                thing the page exists for was 1,574px below the brief, past the
                entire statute. Somebody who had just read the brief and decided
                how they felt had to scroll through the whole bill to say so.

                It sits BELOW the divider deliberately. Above it, it reads as
                the last item of the record's metadata; below it, it opens the
                part of the page that is about deciding — vote, then the brief
                explaining what you are deciding on.

                Rendered ONCE either way. The same card in one of two places,
                never two cards that can disagree about the tally.
              */}
              {!isWide ? (
                <div className="mb-6">
                  <VotePanel reference={reference} />
                </div>
              ) : null}

              <CitizensBriefCard
                state={citizenBrief.state}
                brief={citizenBrief.brief}
                reason={citizenBrief.reason}
                isRequesting={citizenBrief.isRequesting}
                onRequest={citizenBrief.request}
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
                  {/*
                    break-words alongside pre-wrap: keep the bill's own line
                    breaks and indentation, which carry meaning in a statute,
                    but let a line too long for the screen wrap instead of
                    setting the width of the whole page. overflow-auto so a
                    line that still cannot wrap — a long unbroken citation —
                    scrolls inside this box and nowhere else.
                  */}
                  <div className="mt-3 max-h-[28rem] overflow-auto overscroll-contain whitespace-pre-wrap break-words rounded-xl border border-border bg-secondary/40 p-5 font-mono text-sm leading-relaxed text-foreground/80">
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
                  {/* WHETHER THIS RULING IS BINDING LAW, in the Court's own
                      word for it. Shown only when we hold it: an empty line is
                      honest, and the badge already reports the gap. */}
                  {reference.precedentialStatus ? (
                    <MetaRow
                      icon={Scale}
                      label="Precedential status"
                      value={reference.precedentialStatus}
                    />
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

              {/* Last, deliberately: you say something about a law after you
                  have read it, not before. */}
              <Conversation referenceId={reference.id} ready={loaded >= 1} />
            </article>

            {/* Vote sidebar */}
            <aside className="min-w-0 xl:sticky xl:top-20">
              {isWide ? <VotePanel reference={reference} /> : null}

              {/* THE GAP — the people here against the chamber that voted.
                  It sat only on /bill/:id, which is to say on the screen this
                  page replaces, so the single most compelling thing the
                  platform can show was on the page nobody was being sent to.
                  It says which state it is in rather than rendering nothing:
                  "Congress has not voted yet" and "not enough people here have
                  voted yet" are different sentences. */}
              <div className="mt-4">
                <RepresentationGapPanel referenceId={reference.id} ready={loaded >= 2} />
              </div>

              {/* Only this platform can do either of these: every post is
                  attached to a government record, and every position on that
                  record is known. */}
              <PulseHistory referenceId={reference.id} ready={loaded >= 2} />
              <TurningPoints referenceId={reference.id} ready={loaded >= 2} />
              <OtherSide referenceId={reference.id} ready={loaded >= 2} />

              {/* ARTICLE III §2. The tally above is the platform's claim; this
                  is where anybody can make it prove itself. */}
              <div className="mt-4">
                <IntegrityAuditPanel
                  subjectType="reference"
                  subjectId={reference.id}
                  title="Integrity Audit of this vote"
                  what="the votes on this record, as totals and timings"
                  ready={loaded >= 2}
                />
              </div>
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}
