import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  FileText,
  Scale,
  Building2,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { ReferenceCard } from "@/components/civic/ReferenceCard";
import { civicApi, type GovReference, type ReferenceType } from "@/lib/civic";

type DiscoverTab = "trending" | "bills" | "executive" | "judicial";

interface TabConfig {
  type: DiscoverTab;
  label: string;
  icon: typeof TrendingUp;
  referenceType?: ReferenceType;
}

const TABS: TabConfig[] = [
  { type: "trending", label: "Trending", icon: TrendingUp },
  { type: "bills", label: "Congress", icon: Building2, referenceType: "bill" },
  { type: "executive", label: "Executive", icon: FileText, referenceType: "executive_order" },
  { type: "judicial", label: "SCOTUS", icon: Scale, referenceType: "scotus_case" },
];

function ReferenceSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 space-y-3">
      <Skeleton className="h-5 w-3/4 bg-slate-700" />
      <Skeleton className="h-3 w-full bg-slate-700" />
      <Skeleton className="h-2 w-full bg-slate-700" />
    </div>
  );
}

export default function Explore() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("trending");

  const referenceType = TABS.find((t) => t.type === activeTab)?.referenceType;

  const { data: references = [], isLoading } = useQuery({
    queryKey: ["explore-references", activeTab],
    queryFn: async (): Promise<GovReference[]> => {
      if (activeTab === "trending") {
        const res = await civicApi.trending(20);
        return res?.references ?? [];
      }
      const res = await civicApi.listReferences({
        limit: 20,
        ...(referenceType ? { referenceType } : {}),
      });
      return res?.references ?? [];
    },
  });

  return (
    <AppShell>
      <div className="space-y-4 max-w-2xl">
        <div>
          <h1 className="text-3xl font-bold text-white">The Docket</h1>
          <p className="text-slate-400 text-sm mt-1">
            Explore bills, executive orders, and judicial decisions shaping our government
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.type;
            return (
              <button
                key={tab.type}
                onClick={() => setActiveTab(tab.type)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                  isActive
                    ? "border-amber-600 bg-amber-600/20 text-amber-500"
                    : "border-slate-600 bg-transparent text-slate-400 hover:border-slate-500"
                }`}
              >
                <Icon size={14} />
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Grid */}
        <div className="space-y-3">
          {isLoading ? (
            <>
              <ReferenceSkeleton />
              <ReferenceSkeleton />
              <ReferenceSkeleton />
              <ReferenceSkeleton />
            </>
          ) : references.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 py-12 text-center">
              <TrendingUp className="mx-auto h-8 w-8 text-slate-500" />
              <p className="mt-3 font-semibold text-white">No items found</p>
              <p className="mt-1 text-sm text-slate-400">
                Try a different category
              </p>
            </div>
          ) : (
            references.map((reference, i) => (
              <ReferenceCard key={reference.id} reference={reference} index={i} />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
