import { useQuery } from "@tanstack/react-query";
import { Gavel, RotateCcw, Scale, ShieldOff } from "lucide-react";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Badge } from "@/components/ui/badge";

/**
 * ARTICLE V FILINGS — Articles of Impeachment and Articles of System Reset.
 *
 * READ ONLY, AND THAT IS THE FEATURE. There is no button on this tab that
 * stops, pauses, or overturns a proceeding, because there is no route behind
 * one at any permission level, including the owner's. Article V is the
 * people's remedy against borrowed power; a remedy the platform can switch off
 * is not a remedy, and a queue with a Dismiss button would quietly become one.
 *
 * The remedy against a bad-faith filing is against the FILER, through the
 * ordinary suspend and ban powers on the Users tab. That runs alongside the
 * proceeding rather than stopping it: a filer being sanctioned does not make
 * the accusation untrue.
 */

interface Person {
  id: string;
  name: string;
  username: string | null;
  email: string;
}

interface ImpeachmentFiling {
  id: string;
  kind: "impeachment";
  status: string;
  grounds: string;
  evidence: string;
  accused: Person;
  filedBy: Person;
  openedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  suspendedUntil: string | null;
  votes: number;
  electorCount: number;
}

interface ResetFiling {
  id: string;
  kind: "system_reset";
  status: string;
  grounds: string;
  evidence: string;
  /** Null when the filer's account is gone. There is no foreign key on purpose. */
  filedBy: Person | null;
  openedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  executeAfter: string | null;
  executedAt: string | null;
  revertedAt: string | null;
  revertedBy: string | null;
  eligibleCount: number;
}

interface ArticlesResponse {
  articles: ImpeachmentFiling[];
  resets: ResetFiling[];
  total: number;
  openCount: number;
  canStopProceedings: boolean;
}

function who(person: Person | null): string {
  if (!person) return "an account that no longer exists";
  return person.username ? `@${person.username}` : person.name;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function Filing({
  title,
  icon,
  status,
  meta,
  grounds,
  evidence,
}: {
  title: React.ReactNode;
  icon: React.ReactNode;
  status: string;
  meta: { label: string; value: string }[];
  grounds: string;
  evidence: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {icon}
        <span className="font-semibold text-foreground">{title}</span>
        <Badge variant={status === "open" || status === "voting" ? "default" : "secondary"}>
          {status}
        </Badge>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {meta.map((row) => (
          <div key={row.label} className="flex gap-2">
            <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Grounds
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{grounds}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{evidence}</p>
        </div>
      </div>
    </div>
  );
}

export function ArticlesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "articles"],
    queryFn: () =>
      api.get<ArticlesResponse>("/api/admin/articles", { headers: adminAuthHeader() }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Scale className="h-4 w-4 text-amber-500" />
        <span className="font-semibold text-foreground">Article V filings</span>
        {data?.openCount ? <Badge variant="secondary">{data.openCount} open</Badge> : null}
      </div>

      {/* Said out loud, and read from the server's own answer rather than
          asserted by this file. */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-foreground">
        <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <p>
          <strong>You cannot stop a proceeding.</strong> Not from here, not from anywhere, at any
          permission level. Article V belongs to the people. If a filing is malicious or
          frivolous, act against the person who <em>brought</em> it — suspend or ban them from the
          Users tab. The proceeding still runs its course.
          {data && data.canStopProceedings ? (
            <span className="text-red-500"> The server reports otherwise. That is a bug.</span>
          ) : null}
        </p>
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading filings…</p>
      ) : null}

      {!isLoading && data && data.articles.length === 0 && data.resets.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nobody has filed Articles of Impeachment or Articles of System Reset. Filings appear
          here the moment they are made, at the same time they reach the person named.
        </p>
      ) : null}

      {data?.articles.map((filing) => (
        <Filing
          key={filing.id}
          icon={<Gavel className="h-4 w-4 text-red-500" />}
          title={`Articles of Impeachment — ${who(filing.accused)}`}
          status={filing.status}
          grounds={filing.grounds}
          evidence={filing.evidence}
          meta={[
            { label: "Filed by", value: `${who(filing.filedBy)} (${filing.filedBy.email})` },
            { label: "Accused", value: `${who(filing.accused)} (${filing.accused.email})` },
            { label: "Opened", value: when(filing.openedAt) },
            { label: "Closes", value: when(filing.expiresAt) },
            {
              label: "Votes",
              value: `${filing.votes} of ${filing.electorCount} electors`,
            },
            {
              label: "Suspended until",
              value: when(filing.suspendedUntil),
            },
          ]}
        />
      ))}

      {data?.resets.map((filing) => (
        <Filing
          key={filing.id}
          icon={<RotateCcw className="h-4 w-4 text-red-500" />}
          title="Articles of System Reset"
          status={filing.status}
          grounds={filing.grounds}
          evidence={filing.evidence}
          meta={[
            {
              label: "Filed by",
              value: filing.filedBy ? `${who(filing.filedBy)} (${filing.filedBy.email})` : who(null),
            },
            { label: "Opened", value: when(filing.openedAt) },
            { label: "Closes", value: when(filing.expiresAt) },
            { label: "Eligible accounts", value: String(filing.eligibleCount) },
            { label: "Runs after", value: when(filing.executeAfter) },
            { label: "Executed", value: when(filing.executedAt) },
            ...(filing.revertedAt
              ? [
                  {
                    label: "Put back",
                    value: `${when(filing.revertedAt)} by ${filing.revertedBy ?? "unknown"}`,
                  },
                ]
              : []),
          ]}
        />
      ))}
    </div>
  );
}
