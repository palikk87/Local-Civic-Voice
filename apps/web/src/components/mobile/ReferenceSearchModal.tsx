// Web port of mobile/src/components/ReferenceSearchModal.tsx
import { useState, useCallback, useEffect } from "react";
import { ReferenceQuickView } from "@/components/civic/ReferenceQuickView";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Search, FileText, Scale, Gavel, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type ReferenceType = "bill" | "executive_order" | "scotus_case";

export interface GovernmentReference {
  id: string;
  type: ReferenceType;
  title: string;
  status: string;
  identifier?: string; // e.g., "H.R. 82" for bills, "EO 14147" for executive orders
}

interface ReferenceSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (reference: GovernmentReference) => void;
  /**
   * Expand in place instead of opening a dialog.
   *
   * The composer used this as a modal: attaching a law is REQUIRED to post, so
   * writing a post always meant a full-screen dialog opening over the thing you
   * were writing, choosing, and having it close again. The composer already
   * owns the space; an expander keeps your draft on screen while you pick, and
   * it cannot put an overlay over anything (see BetaWelcomeDialog for what an
   * overlay costs). The dialog form is kept for callers that have nowhere to
   * expand into.
   */
  inline?: boolean;
}

const TABS: { type: ReferenceType; label: string; icon: React.ReactNode }[] = [
  { type: "bill", label: "Bills", icon: <FileText size={16} color="#F59E0B" /> },
  { type: "executive_order", label: "Exec Orders", icon: <Scale size={16} color="#F59E0B" /> },
  { type: "scotus_case", label: "SCOTUS", icon: <Gavel size={16} color="#F59E0B" /> },
];

export default function ReferenceSearchModal({
  visible,
  onClose,
  onSelect,
  inline = false,
}: ReferenceSearchModalProps) {
  const [activeTab, setActiveTab] = useState<ReferenceType>("bill");
  const [searchQuery, setSearchQuery] = useState("");
  // Which result is open in the quick view, if any.
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [references, setReferences] = useState<GovernmentReference[]>([]);
  const [hasError, setHasError] = useState(false);

  const fetchReferences = useCallback(async (type: ReferenceType, search: string) => {
    setIsLoading(true);
    setHasError(false);
    try {
      const params = new URLSearchParams({ referenceType: type, limit: "25" });
      if (search.trim()) params.set("search", search.trim());
      const data = await api.get<{
        references: Array<{
          id: string;
          masterReferenceId: string;
          referenceType: ReferenceType;
          title: string;
          shortTitle: string | null;
          status: string;
        }>;
      }>(`/api/government-references?${params.toString()}`);

      setReferences(
        (data.references ?? []).map((r) => ({
          id: r.id,
          type: r.referenceType,
          title: r.shortTitle || r.title,
          status: r.status,
          identifier: r.masterReferenceId?.toUpperCase().replace(/-/g, " "),
        })),
      );
    } catch {
      // Never substitute placeholder references — a fabricated reference cannot
      // be linked to a real government action, so the post would count toward
      // nothing. Surface the failure and let the user retry instead.
      setReferences([]);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch references when tab or search changes
  useEffect(() => {
    if (visible) {
      const timeoutId = setTimeout(() => {
        fetchReferences(activeTab, searchQuery);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [activeTab, searchQuery, visible, fetchReferences]);

  const handleTabChange = (type: ReferenceType) => {
    setActiveTab(type);
  };

  const handleSelectReference = (reference: GovernmentReference) => {
    onSelect(reference);
    onClose();
  };

  const handleClose = () => {
    setSearchQuery("");
    onClose();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "enacted":
      case "signed_into_law":
      case "active":
      case "decided":
        return "bg-green-500/20 text-green-400";
      case "in_committee":
      case "passed_house":
      case "passed_senate":
      case "argued":
      case "pending":
        return "bg-amber-500/20 text-amber-400";
      case "vetoed":
      case "revoked":
      case "dismissed":
        return "bg-red-500/20 text-red-400";
      default:
        return "bg-slate-500/20 text-slate-400";
    }
  };

  const formatStatus = (status: string) => {
    return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const getTypeIcon = (type: ReferenceType) => {
    switch (type) {
      case "bill":
        return <FileText size={18} color="#F59E0B" />;
      case "executive_order":
        return <Scale size={18} color="#F59E0B" />;
      case "scotus_case":
        return <Gavel size={18} color="#F59E0B" />;
    }
  };

  const getTypeBadgeColor = (type: ReferenceType) => {
    switch (type) {
      case "bill":
        return "bg-blue-500/20 text-blue-400";
      case "executive_order":
        return "bg-purple-500/20 text-purple-400";
      case "scotus_case":
        return "bg-rose-500/20 text-rose-400";
    }
  };

  const getTypeLabel = (type: ReferenceType) => {
    switch (type) {
      case "bill":
        return "Bill";
      case "executive_order":
        return "Exec Order";
      case "scotus_case":
        return "SCOTUS";
    }
  };

  // The picker itself. Identical either way — only the frame around it differs.
  /*
   * READING A LAW IS A POP-UP OVER THE LIST, NOT A PAGE INSTEAD OF IT.
   *
   * Khalid: "keep the see details as a pop up rather than opening the law card
   * on a new page it maintains continuity." You are in the middle of writing a
   * post; checking which law you have got should not move you anywhere. The
   * search, the results and the draft all stay exactly where they were, behind
   * it, and closing puts you back with nothing to redo.
   */
  const panel = (
    <>
        {/* Search Input */}
        <div className="px-4 py-3 shrink-0">
          <div className="flex items-center bg-slate-800 rounded-xl px-4 py-3">
            <Search size={20} color="#64748B" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search bills, executive orders, cases..."
              autoCapitalize="none"
              autoCorrect="off"
              className="flex-1 ml-3 bg-transparent text-white text-base outline-none placeholder:text-slate-500"
            />
            {searchQuery.length > 0 ? (
              <button onClick={() => setSearchQuery("")}>
                <X size={18} color="#64748B" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex px-4 pb-3 shrink-0">
          {TABS.map((tab) => (
            <button
              key={tab.type}
              onClick={() => handleTabChange(tab.type)}
              className={cn(
                "flex-1 flex items-center justify-center py-2.5 mx-1 rounded-lg transition-colors",
                activeTab === tab.type ? "bg-amber-500/20" : "bg-slate-800"
              )}
            >
              {tab.icon}
              <span
                className={cn(
                  "ml-1.5 text-sm font-medium",
                  activeTab === tab.type ? "text-amber-400" : "text-slate-400"
                )}
              >
                {tab.label}
              </span>
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center py-16">
              <Loader2 size={32} className="animate-spin text-amber-500" />
              <p className="text-slate-400 mt-4">Searching...</p>
            </div>
          ) : hasError ? (
            <MotionDiv
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center px-8 py-16"
            >
              <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                <AlertCircle size={32} className="text-red-400" />
              </div>
              <p className="text-white text-center text-base font-medium mb-1">
                Couldn't load references
              </p>
              <p className="text-slate-400 text-center text-sm mb-5">
                Check your connection and try again.
              </p>
              <button
                onClick={() => fetchReferences(activeTab, searchQuery)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 transition-colors"
              >
                <RefreshCw size={16} className="text-amber-400" />
                <span className="text-amber-400 font-medium text-sm">Retry</span>
              </button>
            </MotionDiv>
          ) : references.length === 0 ? (
            <MotionDiv
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center px-8 py-16"
            >
              <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
                <Search size={32} color="#64748B" />
              </div>
              <p className="text-slate-400 text-center text-base">
                {searchQuery
                  ? `No ${getTypeLabel(activeTab).toLowerCase()}s found matching "${searchQuery}"`
                  : `Search for ${getTypeLabel(activeTab).toLowerCase()}s to reference in your post`}
              </p>
            </MotionDiv>
          ) : (
            <MotionDiv initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pb-5">
              {references.map((item) => (
                /*
                 * TWO THINGS TO DO WITH A RESULT, so it cannot be one button.
                 *
                 * Attaching a law to a post and reading the law are different
                 * acts, and picking the wrong one used to cost you the search.
                 * A button cannot contain a button, so the row is a container
                 * and each act is its own control.
                 */
                <div key={item.id} className="border-b border-slate-800" data-law-picker>
                <button
                  onClick={() => handleSelectReference(item)}
                  className="w-full p-4 pb-2 hover:bg-slate-800/50 transition-colors text-left"
                >
                  <div className="flex items-start">
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center mr-3 shrink-0">
                      {getTypeIcon(item.type)}
                    </div>
                    <div className="flex-1">
                      <p className="text-white font-medium text-base mb-1 line-clamp-2">
                        {item.title}
                      </p>
                      <div className="flex items-center flex-wrap gap-2">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            getTypeBadgeColor(item.type)
                          )}
                        >
                          {getTypeLabel(item.type)}
                        </span>
                        {item.identifier ? (
                          <span className="text-slate-400 text-xs">{item.identifier}</span>
                        ) : null}
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full text-xs font-medium",
                            getStatusColor(item.status)
                          )}
                        >
                          {formatStatus(item.status)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
                <div className="px-4 pb-3">
                  <button
                    type="button"
                    onClick={() => setQuickViewId(item.id)}
                    className="text-sm font-medium text-amber-400 underline-offset-2 hover:underline"
                  >
                    See details
                  </button>
                </div>
                </div>
              ))}
            </MotionDiv>
          )}
        </div>
    </>
  );

  /** The details pop-up, mounted the same way whichever framing is used. */
  const detailsPopup = (
    <ReferenceQuickView referenceId={quickViewId} onClose={() => setQuickViewId(null)} />
  );

  if (inline) {
    if (!visible) return null;
    return (
      <>
      <div className="mt-3 flex max-h-[420px] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-4 py-2">
          <span className="text-sm font-semibold text-white">Attach a law</span>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close the picker"
            className="flex h-8 w-8 items-center justify-center"
          >
            <X size={18} color="#94A3B8" />
          </button>
        </div>
        {panel}
      </div>
      {detailsPopup}
      </>
    );
  }

  return (
    <Dialog open={visible} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent className="bg-slate-900 border-slate-800 p-0 max-w-lg w-full h-[85vh] flex flex-col overflow-hidden [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
          <button onClick={handleClose} className="w-10 h-10 flex items-center justify-center">
            <X size={24} color="#94A3B8" />
          </button>

          <span className="text-white font-semibold text-lg">Select Reference</span>

          <span className="w-10" />
        </div>
        {panel}
      </DialogContent>

      {detailsPopup}
    </Dialog>
  );
}
