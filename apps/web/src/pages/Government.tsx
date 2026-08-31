/**
 * Web port of mobile `webapp/mobile/src/app/(tabs)/government.tsx`.
 *
 * Same four sections (Congress / Executive / Judicial / Leadership), same filters,
 * same detail view and contact actions — laid out for the web and responsive on
 * desktop. Data comes from the same endpoints the mobile screen calls.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Building2,
  Crown,
  Landmark,
  ListOrdered,
  MapPin,
  RefreshCw,
  Scale,
  Search,
  Users,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ordinal } from "@/lib/civic";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DetailDialog,
  FilterPill,
  MemberCard,
  OfficialCard,
  SectionHeading,
  type Person,
} from "@/components/government/GovernmentCards";
import {
  EXECUTIVE_GROUPS,
  fetchMembers,
  fetchOfficials,
  statesFromMembers,
  type Chamber,
  type Official,
  type Party,
} from "@/lib/government-service";
import { cn } from "@/lib/utils";

type Section = "congress" | "executive" | "judicial" | "leadership";

const SECTIONS: Array<{ key: Section; label: string; icon: typeof Landmark }> = [
  { key: "congress", label: "Congress", icon: Landmark },
  { key: "executive", label: "Executive", icon: Crown },
  { key: "judicial", label: "SCOTUS", icon: Scale },
  { key: "leadership", label: "Leadership", icon: ListOrdered },
];

export default function Government() {
  const [section, setSection] = useState<Section>("congress");
  const [searchQuery, setSearchQuery] = useState("");
  const [chamber, setChamber] = useState<Chamber | "all">("all");
  const [party, setParty] = useState<Party | "all">("all");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Person | null>(null);

  const congressQuery = useQuery({
    queryKey: ["congress-members"],
    queryFn: () => fetchMembers(),
    staleTime: 60 * 60 * 1000,
  });

  const officialsQuery = useQuery({
    queryKey: ["government-officials"],
    queryFn: () => fetchOfficials(),
    staleTime: 60 * 60 * 1000,
  });

  const congress = congressQuery.data;
  const officials = officialsQuery.data;
  const loading = congressQuery.isLoading || officialsQuery.isLoading;
  const error = congressQuery.error ?? officialsQuery.error;

  const members = congress?.representatives ?? [];
  const states = useMemo(() => statesFromMembers(members), [members]);

  // Filtering runs against the already-loaded roster so the chips respond instantly;
  // the same filters exist server-side for direct API use.
  const filteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return members.filter((m) => {
      if (chamber !== "all" && m.chamber !== chamber) return false;
      if (party !== "all" && m.party !== party) return false;
      if (stateFilter !== "all" && m.state !== stateFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.stateName.toLowerCase().includes(q) ||
        m.state.toLowerCase() === q ||
        (m.leadershipRole?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [members, chamber, party, stateFilter, searchQuery]);

  const filterOfficials = (list: Official[]): Official[] => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.title.toLowerCase().includes(q) ||
        (o.bio?.toLowerCase().includes(q) ?? false),
    );
  };

  const searchPlaceholder =
    section === "congress" ? "Search by name, state or role..." : "Search by name or title...";

  return (
    <AppShell wide>
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Government
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every federal official, across all three branches
          </p>

          {/* THE FRESHNESS STRIP THAT WAS HERE ANSWERED THE WRONG QUESTION.
              It reports on GovernmentReference — bills, executive orders, court
              cases — so on a page headed "Every federal official" it announced
              a count of laws and quoted a BILL TITLE as "the most recent action
              we hold". A reader looking up their senator was told about
              sanctions on the People's Republic of China.

              This page is about people, and it already says how current its
              people are, at the bottom, from the roster's own lastUpdated. The
              references strip moved to Discover, where the references are.

              What replaces it is the RIGHT question for this page, answered
              from the roster this page actually shows. */}
          {officials?.lastUpdated || congress ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {members.length > 0 ? `${members.length} members of Congress` : "Congress roster"}
                {congress?.source === "fallback" ? " (cached snapshot)" : ""} from Congress.gov
              </span>
              {officials?.lastUpdated ? (
                <span>
                  · Executive and judicial checked{" "}
                  {new Date(officials.lastUpdated).toLocaleDateString()}
                </span>
              ) : null}
            </p>
          ) : null}

          <div className="relative mt-4">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-12 rounded-xl pl-11 pr-11 text-[15px]"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Branch tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SECTIONS.map((item) => {
            const active = section === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={cn(
                  "inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-4 py-2.5 font-medium transition-colors",
                  active
                    ? "bg-amber-500 text-slate-900"
                    : "bg-card text-foreground/80 hover:bg-muted",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="space-y-3 pt-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
            <p className="mt-4 text-lg text-foreground">Couldn't load government data</p>
            {/* NOT `error.message`. That is whatever threw — and when the
                query resolves to nothing, TanStack Query's own text is
                `["congress-members"] data is undefined`, which a reader saw
                printed on the page, brackets and all. An error a person cannot
                act on should say what they CAN do. The real message still
                reaches the console for whoever is debugging. */}
            <p className="mt-1 text-sm text-muted-foreground">
              The roster comes from congress.gov. If this keeps happening, the
              sync may not have run yet.
            </p>
            <Button
              className="mt-5 bg-amber-500 text-slate-900 hover:bg-amber-400"
              onClick={() => {
                void congressQuery.refetch();
                void officialsQuery.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {section === "congress" ? (
              <>
                {/* Chamber counts */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-blue-800/30 bg-blue-900/30 p-3">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-blue-500" />
                      <span className="text-xs font-medium text-blue-400">House</span>
                    </div>
                    <p className="text-xl font-bold text-foreground">{congress?.counts?.house ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Representatives</p>
                  </div>
                  <div className="rounded-xl border border-purple-800/30 bg-purple-900/30 p-3">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-purple-500" />
                      <span className="text-xs font-medium text-purple-400">Senate</span>
                    </div>
                    <p className="text-xl font-bold text-foreground">{congress?.counts?.senate ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Senators</p>
                  </div>
                </div>

                {/* Chamber + party filters */}
                <div className="flex flex-wrap items-center gap-2">
                  <FilterPill label="All" active={chamber === "all"} onClick={() => setChamber("all")} />
                  <FilterPill label="House" active={chamber === "house"} onClick={() => setChamber("house")} />
                  <FilterPill label="Senate" active={chamber === "senate"} onClick={() => setChamber("senate")} />
                  <span className="mx-1 h-6 w-px bg-border" />
                  <FilterPill label="All parties" active={party === "all"} onClick={() => setParty("all")} />
                  <FilterPill label="Democrat" active={party === "D"} onClick={() => setParty("D")} />
                  <FilterPill label="Republican" active={party === "R"} onClick={() => setParty("R")} />
                  <FilterPill label="Independent" active={party === "I"} onClick={() => setParty("I")} />
                </div>

                {/* State filter */}
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Select value={stateFilter} onValueChange={setStateFilter}>
                    <SelectTrigger className="h-10 w-full max-w-xs">
                      <SelectValue placeholder="All states" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="all">All states</SelectItem>
                      {states.map((s) => (
                        <SelectItem key={s.code} value={s.code}>
                          {s.name} ({s.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-xs text-muted-foreground">
                  {/* The congress number arrives with the roster, so until it
                      does this read "members of the th Congress". */}
                  Showing {filteredMembers.length} of {members.length} members
                  {congress?.congress ? ` of the ${ordinal(congress.congress)} Congress` : null}
                </p>

                <div className="space-y-3">
                  {filteredMembers.map((member) => (
                    <MemberCard key={member.id} member={member} onSelect={setSelected} />
                  ))}
                  {filteredMembers.length === 0 ? <EmptyState /> : null}
                </div>
              </>
            ) : null}

            {section === "executive" && officials
              ? EXECUTIVE_GROUPS.map((group) => {
                  const list = filterOfficials(
                    officials.executive.filter((o) => o.group === group.key),
                  );
                  if (list.length === 0) return null;
                  return (
                    <section key={group.key}>
                      <SectionHeading title={group.label} blurb={group.blurb} count={list.length} />
                      <div className="space-y-3">
                        {list.map((official) => (
                          <OfficialCard key={official.id} official={official} onSelect={setSelected} />
                        ))}
                      </div>
                    </section>
                  );
                })
              : null}

            {section === "judicial" && officials ? (
              <section>
                <SectionHeading
                  title="Supreme Court of the United States"
                  blurb="Nine Justices, appointed for life. Chief Justice first, then Associate Justices by seniority."
                  count={officials.judicial.length}
                />
                <div className="space-y-3">
                  {filterOfficials(officials.judicial).map((justice) => (
                    <OfficialCard key={justice.id} official={justice} onSelect={setSelected} />
                  ))}
                  {filterOfficials(officials.judicial).length === 0 ? <EmptyState /> : null}
                </div>
              </section>
            ) : null}

            {section === "leadership" && officials ? (
              <>
                <section>
                  <SectionHeading
                    title="Congressional Leadership"
                    blurb="Members currently holding a leadership post"
                    count={officials.congressionalLeadership.length}
                  />
                  <div className="space-y-3">
                    {filterOfficials(officials.congressionalLeadership).map((leader) => (
                      <OfficialCard
                        key={`${leader.id}-lead`}
                        official={leader}
                        onSelect={setSelected}
                      />
                    ))}
                  </div>
                </section>

                <section>
                  <SectionHeading
                    title="Presidential Line of Succession"
                    blurb="Statutory order of offices. Officials serving in an acting capacity are not eligible to act as President."
                    count={officials.succession.length}
                  />
                  <div className="space-y-3">
                    {filterOfficials(officials.succession).map((person) => (
                      <OfficialCard
                        key={`${person.id}-succ`}
                        official={person}
                        rank={person.successionOrder}
                        onSelect={setSelected}
                      />
                    ))}
                  </div>
                </section>
              </>
            ) : null}

            {/* Provenance */}
            {congress ? (
              <p className="pt-4 text-center text-xs text-muted-foreground/70">
                Congress roster from Congress.gov
                {congress.source === "fallback" ? " (cached snapshot)" : ""} · Executive and judicial
                data verified{" "}
                {officials ? new Date(officials.lastUpdated).toLocaleDateString() : ""}
              </p>
            ) : null}
          </>
        )}
      </div>

      <DetailDialog person={selected} onClose={() => setSelected(null)} />
    </AppShell>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center py-12">
      <Search className="h-12 w-12 text-muted-foreground" />
      <p className="mt-4 text-lg text-muted-foreground">No officials found</p>
      <p className="mt-1 text-sm text-muted-foreground/70">Try a different search or filter</p>
    </div>
  );
}
