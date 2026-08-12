// Web port of DiscoverTabSelector in webapp/mobile/src/app/(tabs)/discover.tsx
import { Flame, FileText, Scale, Building2, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

export type DiscoverTab = "trending" | "legislative" | "executive" | "judicial" | "government";

const tabs: { id: DiscoverTab; label: string; color: string }[] = [
  { id: "trending", label: "Trending", color: "#F59E0B" },
  { id: "legislative", label: "Congress", color: "#3B82F6" },
  { id: "executive", label: "Executive", color: "#F59E0B" },
  { id: "judicial", label: "Judicial", color: "#8B5CF6" },
  { id: "government", label: "Gov Map", color: "#3B82F6" },
];

function TabIcon({ tabId, color }: { tabId: DiscoverTab; color: string }) {
  switch (tabId) {
    case "trending":
      return <Flame size={16} color={color} />;
    case "legislative":
      return <Landmark size={16} color={color} />;
    case "executive":
      return <FileText size={16} color={color} />;
    case "judicial":
      return <Scale size={16} color={color} />;
    case "government":
      return <Building2 size={16} color={color} />;
  }
}

export function DiscoverTabSelector({
  activeTab,
  onChangeTab,
}: {
  activeTab: DiscoverTab;
  onChangeTab: (tab: DiscoverTab) => void;
}) {
  return (
    <div className="mb-4 flex">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const iconColor = isActive ? "#fff" : tab.color;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChangeTab(tab.id)}
            className={cn(
              "relative mx-1 flex min-h-[44px] flex-1 items-center justify-center overflow-hidden rounded-xl py-2.5 transition-colors",
              isActive ? "border-transparent" : "border border-border/50 bg-card/60 hover:bg-card",
            )}
            style={
              isActive
                ? { background: `linear-gradient(to right, ${tab.color}, ${tab.color}AA)` }
                : undefined
            }
          >
            <TabIcon tabId={tab.id} color={iconColor} />
            <span
              className={cn(
                "ml-1.5 text-xs font-medium",
                isActive ? "text-white" : "text-muted-foreground",
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
