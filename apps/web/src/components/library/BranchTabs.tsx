import { Landmark, FileText, Scale, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryBranch } from "@/lib/library";

interface BranchMeta {
  key: LibraryBranch;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const BRANCH_TABS: BranchMeta[] = [
  { key: "congress", label: "Congress", icon: Landmark, color: "hsl(var(--legislative))" },
  { key: "executive", label: "Executive", icon: FileText, color: "hsl(var(--executive))" },
  { key: "judicial", label: "Judicial", icon: Scale, color: "hsl(var(--judicial))" },
];

export function BranchTabs({
  value,
  onChange,
}: {
  value: LibraryBranch;
  onChange: (branch: LibraryBranch) => void;
}) {
  return (
    <div className="flex gap-2 rounded-2xl border border-border bg-card p-1.5">
      {BRANCH_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            style={
              active
                ? {
                    color: tab.color,
                    backgroundColor: `color-mix(in srgb, ${tab.color} 15%, transparent)`,
                  }
                : undefined
            }
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
