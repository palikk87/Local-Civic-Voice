// Web port of the EmptyState in webapp/mobile/src/app/(tabs)/library.tsx
import { Search } from "lucide-react";
import type { LibraryBranch } from "@/lib/library";

const BRANCH_INFO: Record<LibraryBranch, { name: string; source: string; suggestions: string[] }> = {
  congress: {
    name: "Congressional Bills",
    source: "Congress.gov",
    suggestions: ["healthcare", "gun laws", "immigration", "taxes", "climate change", "education"],
  },
  executive: {
    name: "Executive Orders",
    source: "Federal Register",
    suggestions: ["immigration", "trade", "environment", "defense", "economy"],
  },
  judicial: {
    name: "Court Cases",
    source: "CourtListener",
    suggestions: ["civil rights", "free speech", "privacy", "voting rights"],
  },
};

export function LibraryEmptyState({
  branch,
  onSuggestionPress,
}: {
  branch: LibraryBranch;
  onSuggestionPress: (suggestion: string) => void;
}) {
  const info = BRANCH_INFO[branch];

  return (
    <div className="px-2 pt-8 animate-in fade-in duration-300">
      <div className="mb-8 flex flex-col items-center">
        <div className="mb-4 rounded-full bg-muted/50 p-6">
          <Search className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="mb-2 text-lg font-semibold text-foreground">Search {info.name}</p>
        <p className="text-center text-sm text-muted-foreground">
          Type what you're looking for in plain English
        </p>
      </div>

      {/* Suggestion chips */}
      <div className="mb-6">
        <p className="mb-3 text-center text-xs font-medium text-muted-foreground">
          TRY SEARCHING FOR
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {info.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onSuggestionPress(suggestion)}
              className="min-h-[40px] rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground/80 transition-colors hover:bg-muted active:opacity-70"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div className="mx-auto max-w-md rounded-xl border border-border/60 bg-card/50 p-4">
        <p className="mb-2 text-xs font-semibold text-amber-500">TIPS</p>
        <div className="space-y-1 text-sm leading-5 text-muted-foreground">
          <p>• Use everyday language like "gun laws" or "healthcare"</p>
          <p>• AI will understand what you mean</p>
          <p>• Results show the most relevant bills first</p>
        </div>
      </div>
    </div>
  );
}
