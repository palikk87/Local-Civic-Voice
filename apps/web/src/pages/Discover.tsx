// Web port of webapp/mobile/src/app/(tabs)/discover.tsx
import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, TrendingUp, Landmark, FileText, Scale, Loader2 } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/input";
import { MotionDiv } from "@/components/civic/Motion";
import { DiscoverTabSelector, type DiscoverTab } from "@/components/discover/DiscoverTabSelector";
import { TrendingBillCard } from "@/components/discover/TrendingBillCard";
import { ExecutiveOrderCard } from "@/components/discover/ExecutiveOrderCard";
import { SupremeCourtCaseCard } from "@/components/discover/SupremeCourtCaseCard";
import { GovernmentBranchSection } from "@/components/discover/GovernmentBranchSection";
import {
  PresidentialSuccessionSection,
  SupremeCourtJusticesSection,
  DataFreshnessIndicator,
} from "@/components/discover/GovernmentOverview";
import { mockBills, categoryLabels } from "@/lib/mobile/mock-data";
import { executiveOrders, supremeCourtCases } from "@/lib/mobile/government-data";
import { fetchOfficials } from "@/lib/government-service";
import { useQuery } from "@tanstack/react-query";
import type { Bill, BillCategory, GovernmentBranch } from "@/lib/mobile/types";
import { useBills as useApiBills, type ApiBill } from "@/lib/mobile/api-hooks";
import { useTrendingReferences, useLatestReferences } from "@/hooks/use-government-references";
import {
  referenceToBill,
  referenceToExecutiveOrder,
  referenceToScotusCase,
} from "@/lib/mobile/reference-mappers";
import { cn } from "@/lib/utils";

const categories: BillCategory[] = [
  "healthcare",
  "education",
  "environment",
  "economy",
  "technology",
  "housing",
  "civil_rights",
  "immigration",
];

// Convert API bill to legacy format for existing components
function convertApiBillToLegacy(bill: ApiBill): Bill {
  return {
    id: bill.id,
    title: bill.title,
    shortTitle: bill.title.length > 50 ? bill.title.substring(0, 50) + "..." : bill.title,
    status: bill.status as Bill["status"],
    chamber: bill.chamber,
    sponsor: {
      id: "sponsor",
      name: bill.sponsor,
      party: "D" as const,
      state: "US",
      chamber: bill.chamber,
      imageUrl: "",
    },
    introducedDate: bill.introducedDate ?? new Date().toISOString(),
    lastActionDate: bill.lastActionDate ?? new Date().toISOString(),
    category: bill.category as BillCategory,
    fullText: bill.fullText ?? bill.summary,
    simplifiedText: bill.summary,
    realWorldImpact: "",
    relatedLaws: [],
    communityVotes: {
      yea: bill.votes.support,
      nay: bill.votes.oppose,
      totalVoters: bill.votes.total || 1,
    },
    projectedOutcome: bill.votes.support > bill.votes.oppose ? "likely_pass" : "uncertain",
  };
}

export default function Discover() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DiscoverTab>("trending");
  const [expandedBranches, setExpandedBranches] = useState<Record<GovernmentBranch, boolean>>({
    executive: true,
    legislative: false,
    judicial: false,
  });

  // API data - uses real backend
  const { data: apiBillsData, isLoading } = useApiBills();

  // Live daily-synced data: 10 most popular per branch of government
  const { data: billRefsData, isLoading: billRefsLoading } = useTrendingReferences("bill", 10);
  const { data: eoRefsData, isLoading: eoRefsLoading } = useTrendingReferences("executive_order", 10);
  const { data: scotusRefsData, isLoading: scotusRefsLoading } = useTrendingReferences("scotus_case", 10);
  // Newest synced bills — keeps the "All Legislation" list up to date even
  // before the community has voted on them.
  const { data: latestBillsData } = useLatestReferences("bill", 30);

  // Toggle branch expansion
  const toggleBranch = useCallback((branch: GovernmentBranch) => {
    setExpandedBranches((prev) => ({
      ...prev,
      [branch]: !prev[branch],
    }));
  }, []);

  // Filterable bill list: newest synced bills first, then popular ones and any
  // DB bills. Static mock bills are only a fallback when the backend is unreachable.
  const filteredBills = useMemo(() => {
    const latestBills = (latestBillsData?.references ?? []).map(referenceToBill);
    const trendingRefBills = (billRefsData?.references ?? []).map(referenceToBill);
    const apiBills = (apiBillsData?.pages?.flatMap((page) => page.bills) ?? []).map(convertApiBillToLegacy);
    const seen = new Set<string>();
    const liveBills = [...latestBills, ...trendingRefBills, ...apiBills].filter((bill) => {
      if (seen.has(bill.id)) return false;
      seen.add(bill.id);
      return true;
    });
    const allBills = liveBills.length > 0 ? liveBills : mockBills;

    // Filter by category and search
    return allBills.filter((bill) => {
      if (selectedCategory && bill.category !== selectedCategory) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          bill.title.toLowerCase().includes(query) ||
          bill.shortTitle.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [latestBillsData, billRefsData, apiBillsData, selectedCategory, searchQuery]);

  // 10 most popular bills in the legislative branch (live, daily-synced)
  const trendingBills = useMemo(() => {
    const referenceBills = (billRefsData?.references ?? []).map(referenceToBill);
    if (referenceBills.length > 0) return referenceBills.slice(0, 10);

    // Fallback when the backend is unreachable
    const apiBills = (apiBillsData?.pages?.flatMap((page) => page.bills) ?? []).map(convertApiBillToLegacy);
    return [...apiBills, ...mockBills]
      .sort((a, b) => b.communityVotes.totalVoters - a.communityVotes.totalVoters)
      .slice(0, 10);
  }, [billRefsData, apiBillsData]);

  // 10 most popular executive orders (live, daily-synced)
  const executiveOrderItems = useMemo(() => {
    const refs = (eoRefsData?.references ?? []).map(referenceToExecutiveOrder);
    return refs.length > 0 ? refs.slice(0, 10) : executiveOrders;
  }, [eoRefsData]);

  // 10 most popular Supreme Court cases (live, daily-synced)
  const scotusItems = useMemo(() => {
    const refs = (scotusRefsData?.references ?? []).map(referenceToScotusCase);
    return refs.length > 0 ? refs.slice(0, 10) : supremeCourtCases;
  }, [scotusRefsData]);

  // Live government data — the SAME endpoint and query cache the Government tab
  // uses (/api/government/officials), so the Gov Map always matches it.
  const { data: officials, isLoading: officialsLoading } = useQuery({
    queryKey: ["government-officials"],
    queryFn: fetchOfficials,
    staleTime: 5 * 60 * 1000,
  });

  const executiveDepts = useMemo(
    () => (officials?.departments ?? []).filter((d) => d.branch === "executive"),
    [officials],
  );
  const legislativeDepts = useMemo(
    () => (officials?.departments ?? []).filter((d) => d.branch === "legislative"),
    [officials],
  );
  const judicialDepts = useMemo(
    () => (officials?.departments ?? []).filter((d) => d.branch === "judicial"),
    [officials],
  );

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="py-3">
          <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Discover
          </h1>
          <p className="mb-3 text-sm text-muted-foreground">
            Explore all 3 branches of government
          </p>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bills, cases, officials..."
              className="h-12 rounded-xl pl-11 pr-10 text-[15px]"
            />
            {isLoading || billRefsLoading ? (
              <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-amber-500" />
            ) : null}
          </div>
        </div>

        {/* Tab Selector */}
        <DiscoverTabSelector activeTab={activeTab} onChangeTab={setActiveTab} />

        <div className="pb-5">
          {/* TRENDING TAB */}
          {activeTab === "trending" ? (
            <>
              {/* Categories */}
              <div className="mb-4 flex overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className={cn(
                    "mr-2 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                    selectedCategory === null
                      ? "bg-amber-500 text-slate-900"
                      : "bg-card text-foreground/80 hover:bg-muted",
                  )}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      "mr-2 shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                      selectedCategory === cat
                        ? "bg-amber-500 text-slate-900"
                        : "bg-card text-foreground/80 hover:bg-muted",
                    )}
                  >
                    {categoryLabels[cat]}
                  </button>
                ))}
              </div>

              {/* Trending Bills */}
              <div className="mb-3 flex items-center">
                <TrendingUp size={18} color="#F59E0B" />
                <span className="ml-2 text-lg font-semibold text-foreground">
                  Trending Legislation
                </span>
              </div>

              <div className="mb-6 flex overflow-x-auto pb-1">
                {trendingBills.map((bill, index) => (
                  <TrendingBillCard key={bill.id} bill={bill} index={index} />
                ))}
              </div>

              {/* All Bills List */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center">
                  <Landmark size={18} color="#3B82F6" />
                  <span className="ml-2 text-lg font-semibold text-foreground">
                    {selectedCategory
                      ? categoryLabels[selectedCategory as BillCategory]
                      : "All Legislation"}
                  </span>
                </div>
                <span className="text-sm text-muted-foreground">{filteredBills.length} bills</span>
              </div>

              {filteredBills.slice(0, 10).map((bill, index) => (
                <MotionDiv
                  key={bill.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06, type: "spring", stiffness: 260, damping: 24 }}
                  className="mb-3"
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/bill/${bill.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") navigate(`/bill/${bill.id}`);
                    }}
                    className="cursor-pointer rounded-xl border border-border/40 bg-card/60 p-4 transition-colors hover:bg-card"
                  >
                    <p className="font-semibold text-foreground">{bill.shortTitle}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{bill.title}</p>
                  </div>
                </MotionDiv>
              ))}
            </>
          ) : null}

          {/* CONGRESS (LEGISLATIVE) TAB */}
          {activeTab === "legislative" ? (
            <>
              <div className="mb-3">
                <div className="flex items-center">
                  <Landmark size={18} color="#3B82F6" />
                  <span className="ml-2 text-lg font-semibold text-foreground">
                    Legislation
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The 10 most popular bills in Congress
                </p>
              </div>

              {billRefsLoading && trendingBills.length === 0 ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </div>
              ) : (
                trendingBills.map((bill, index) => (
                  <MotionDiv
                    key={bill.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.06, type: "spring", stiffness: 260, damping: 24 }}
                    className="mb-3"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => navigate(`/bill/${bill.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") navigate(`/bill/${bill.id}`);
                      }}
                      className="cursor-pointer rounded-xl border border-blue-700/30 bg-card/60 p-4 transition-colors hover:bg-card"
                    >
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-400">
                          #{index + 1}
                        </span>
                        {bill.congressNumber ? (
                          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-foreground/80">
                            {bill.congressNumber}
                          </span>
                        ) : null}
                        <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs capitalize text-foreground/80">
                          {categoryLabels[bill.category] ?? bill.category}
                        </span>
                      </div>
                      <p className="font-semibold text-foreground">{bill.shortTitle}</p>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{bill.title}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {bill.communityVotes.totalVoters.toLocaleString()} community votes
                      </p>
                    </div>
                  </MotionDiv>
                ))
              )}

              {/* Freshly pulled bills, straight from the daily congress.gov sync */}
              <div className="mb-3 mt-6">
                <div className="flex items-center">
                  <TrendingUp size={18} color="#22C55E" />
                  <span className="ml-2 text-lg font-semibold text-foreground">
                    Newest from Congress
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Pulled in the latest daily sync
                </p>
              </div>
              {(latestBillsData?.references ?? []).slice(0, 10).map((ref) => {
                const bill = referenceToBill(ref);
                return (
                  <div
                    key={`latest-${bill.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/bill/${bill.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") navigate(`/bill/${bill.id}`);
                    }}
                    className="mb-3 cursor-pointer rounded-xl border border-border/40 bg-card/60 p-4 transition-colors hover:bg-card"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {bill.congressNumber ? (
                        <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-foreground/80">
                          {bill.congressNumber}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                        New
                      </span>
                    </div>
                    <p className="font-semibold text-foreground">{bill.shortTitle}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{bill.title}</p>
                  </div>
                );
              })}
            </>
          ) : null}

          {/* EXECUTIVE TAB */}
          {activeTab === "executive" ? (
            <>
              <div className="mb-3">
                <div className="flex items-center">
                  <FileText size={18} color="#F59E0B" />
                  <span className="ml-2 text-lg font-semibold text-foreground">
                    Executive Orders
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The 10 most popular presidential directives
                </p>
              </div>

              {eoRefsLoading && executiveOrderItems.length === 0 ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                </div>
              ) : (
                executiveOrderItems.map((eo, index) => (
                  <ExecutiveOrderCard key={eo.id} eo={eo} index={index} />
                ))
              )}
            </>
          ) : null}

          {/* JUDICIAL TAB */}
          {activeTab === "judicial" ? (
            <>
              <div className="mb-3">
                <div className="flex items-center">
                  <Scale size={18} color="#8B5CF6" />
                  <span className="ml-2 text-lg font-semibold text-foreground">
                    Supreme Court Cases
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The 10 most popular Supreme Court decisions
                </p>
              </div>

              {scotusRefsLoading && scotusItems.length === 0 ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
                </div>
              ) : (
                scotusItems.map((scotusCase, index) => (
                  <SupremeCourtCaseCard key={scotusCase.id} scotusCase={scotusCase} index={index} />
                ))
              )}
            </>
          ) : null}

          {/* GOVERNMENT MAP TAB — live /api/government/officials, same as the Government tab */}
          {activeTab === "government" ? (
            officialsLoading || !officials ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              </div>
            ) : (
              <>
                <DataFreshnessIndicator lastUpdated={officials.lastUpdated ?? null} />

                <PresidentialSuccessionSection succession={officials.succession} />

                <SupremeCourtJusticesSection justices={officials.judicial} />

                <GovernmentBranchSection
                  branch="executive"
                  holders={officials.executive}
                  departments={executiveDepts}
                  expanded={expandedBranches.executive}
                  onToggle={() => toggleBranch("executive")}
                />

                <GovernmentBranchSection
                  branch="legislative"
                  holders={officials.congressionalLeadership}
                  departments={legislativeDepts}
                  expanded={expandedBranches.legislative}
                  onToggle={() => toggleBranch("legislative")}
                />

                <GovernmentBranchSection
                  branch="judicial"
                  holders={officials.judicial}
                  departments={judicialDepts}
                  expanded={expandedBranches.judicial}
                  onToggle={() => toggleBranch("judicial")}
                />
              </>
            )
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
