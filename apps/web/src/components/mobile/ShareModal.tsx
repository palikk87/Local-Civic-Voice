// Web port of mobile/src/components/ShareModal.tsx
import { useState } from "react";
import { X, Share2, MessageCircle, Send, Copy, FileText, Check } from "lucide-react";
import { toast } from "sonner";
import { useStartConversation } from "@/lib/api/messages";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useTimelineStore, type TimelinePost } from "@/lib/mobile/timeline-store";
import { useSignedInIdentity } from "@/lib/mobile/signed-in-identity";
import { useDiscoverUsers } from "@/lib/mobile/api-hooks";
import type { User } from "@/lib/mobile/types";
import { useRequireAuth } from "@/hooks/use-civic-auth";
import { cn } from "@/lib/utils";

type ShareTarget = "timeline" | "message";

interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  post?: TimelinePost;
  content?: {
    type: "bill" | "executive_order" | "scotus_case";
    id: string;
    title: string;
  };
}

export default function ShareModal({ visible, onClose, post, content }: ShareModalProps) {
  const [shareTarget, setShareTarget] = useState<ShareTarget>("timeline");
  const [opinion, setOpinion] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Real people, from /api/users/discover. This list used to be `sampleUsers`
  // from mock-data — a fixed cast of invented accounts — so "share to message"
  // offered you strangers who do not exist and sent nowhere.
  const me = useSignedInIdentity();
  const { data: people, isLoading: peopleLoading } = useDiscoverUsers(20);
  const shareTargets = (people?.results ?? []).filter((u) => u.id !== me?.id);
  const [copied, setCopied] = useState(false);

  const sharePost = useTimelineStore((s) => s.sharePost);
  const shareContent = useTimelineStore((s) => s.shareContent);
  const requireAuth = useRequireAuth();

  const shareTitle = post
    ? post.sharedContent?.title ?? post.content.slice(0, 50) + "..."
    : content?.title ?? "";

  const shareType = post ? post.contentType : content?.type ?? "text";

  const [sharing, setSharing] = useState(false);

  /**
   * SHARING THAT FAILS HAS TO SAY SO.
   *
   * This fired the share and closed the panel in the same breath, without ever
   * waiting for the answer — so a share that the server refused closed the
   * panel, posted nothing, and told nobody. Reported as "the share from the
   * library doesn't reach the timeline"; it never left.
   *
   * Now it waits, and the panel only closes when the post actually exists.
   * Words are optional — putting a law in front of people is the act.
   */
  const handleShareToTimeline = async () => {
    if (!requireAuth("Sign in to share to My Voice.")) return;

    setSharing(true);
    try {
      if (post) {
        await sharePost(post.id, opinion.trim() || undefined);
      } else if (content) {
        await shareContent(content.type, content.id, content.title, opinion.trim() || undefined);
      }
      setOpinion("");
      onClose();
      toast.success("Shared to My Voice");
    } catch {
      toast.error("That didn't post. Try again in a moment.");
    } finally {
      setSharing(false);
    }
  };

  /**
   * SENDING THIS IN A MESSAGE ACTUALLY SENDS IT.
   *
   * Reported twice: "when you click message in share it doesn't give you any
   * ability to actually share it in a message". Two separate faults sat on top
   * of each other.
   *
   * The first: this returned early unless it had a `post`. The feed opens this
   * sheet about the LAW behind a card and passes `content`, never `post`, so
   * picking a person and pressing Send ran three lines and stopped. No error,
   * no message, nothing.
   *
   * The second, and the reason fixing the first alone would have been worse
   * than useless: the store's sendMessage never spoke to the server. It
   * appended to a zustand map and returned. Every screen in Messages reads the
   * real /api/messages endpoints, so a "sent" message was written somewhere
   * nobody — including the sender — would ever see it, and the recipient was
   * never involved at all.
   *
   * POST /api/messages/conversations takes a participant and a first message
   * and does both. It is what Messages already reads back.
   */
  const startConversation = useStartConversation();

  const handleShareToMessage = () => {
    if (!requireAuth("Sign in to send this in a message.")) return;
    if (!selectedUser) return;

    const origin = window.location.origin;
    const link = post
      ? `${origin}/post/${post.id}`
      : content
        ? `${origin}/reference/${content.id}`
        : origin;
    // Their words, then the link. The title is NOT repeated here: the thread
    // renders the link as a card carrying the real title, read live, so a copy
    // pasted in at send time would only be a second version of it — and the
    // wrong one the moment the record is renamed.
    const body = [opinion.trim(), link].filter(Boolean).join("\n\n");

    startConversation.mutate(
      { participantId: selectedUser.id, message: body },
      {
        onSuccess: () => {
          toast.success(`Sent to ${selectedUser.displayName ?? selectedUser.username}`);
          setSelectedUser(null);
          setOpinion("");
          onClose();
        },
        onError: () => toast.error("Couldn't send that message"),
      },
    );
  };

  const handleCopyLink = () => {
    // THE LINK IS TO THE THING BEING SHARED, NOT TO WHERE YOU WERE STANDING.
    //
    // This copied window.location.href, so sharing anything from the feed or a
    // timeline handed somebody "https://ayeandnay.com/timeline" — a link to
    // THEIR timeline, showing none of what was being shared.
    //
    // This sheet is opened two ways and both have a real destination: with a
    // post, whose permalink is /post/:id, and with a law, whose page is
    // /reference/:id. The feed opens it the second way, which is why fixing
    // only the post case left it still copying the page.
    const origin = window.location.origin;
    const url = post
      ? `${origin}/post/${post.id}`
      : content
        ? `${origin}/reference/${content.id}`
        : window.location.href;
    navigator.clipboard.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setOpinion("");
    setSelectedUser(null);
    setShareTarget("timeline");
    onClose();
  };

  return (
    <Dialog open={visible} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent className="bg-slate-900 border-slate-800 p-0 max-w-lg max-h-[85vh] flex flex-col overflow-hidden [&>button]:hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <button onClick={handleClose} className="w-10 h-10 flex items-center justify-center">
            <X size={24} color="#94A3B8" />
          </button>

          <span className="text-white font-semibold text-lg">Share</span>

          <span className="w-10" />
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Content Preview */}
          <div className="mx-4 mt-4 p-4 bg-slate-800/60 rounded-xl border border-slate-700/50">
            <div className="flex items-start">
              <span className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3 shrink-0">
                <FileText size={20} color="#F59E0B" />
              </span>
              <div className="flex-1">
                <p className="text-slate-400 text-xs mb-1">
                  {shareType === "bill"
                    ? "Bill"
                    : shareType === "executive_order"
                    ? "Executive Order"
                    : shareType === "scotus_case"
                    ? "Supreme Court Case"
                    : "Post"}
                </p>
                <p className="text-white font-medium line-clamp-2">{shareTitle}</p>
              </div>
            </div>
          </div>

          {/* Share Options */}
          <div className="flex px-4 mt-4">
            <button
              onClick={() => setShareTarget("timeline")}
              className={cn(
                "flex-1 py-3 rounded-xl mr-2 flex flex-col items-center border",
                shareTarget === "timeline"
                  ? "bg-amber-500/20 border-amber-500/50"
                  : "bg-slate-800/60 border-slate-700/50"
              )}
            >
              <Share2 size={20} color={shareTarget === "timeline" ? "#F59E0B" : "#64748B"} />
              <span
                className={cn(
                  "mt-1 font-medium",
                  shareTarget === "timeline" ? "text-amber-500" : "text-slate-400"
                )}
              >
                My Voice
              </span>
            </button>

            <button
              onClick={() => setShareTarget("message")}
              className={cn(
                "flex-1 py-3 rounded-xl flex flex-col items-center border",
                shareTarget === "message"
                  ? "bg-amber-500/20 border-amber-500/50"
                  : "bg-slate-800/60 border-slate-700/50"
              )}
            >
              <MessageCircle size={20} color={shareTarget === "message" ? "#F59E0B" : "#64748B"} />
              <span
                className={cn(
                  "mt-1 font-medium",
                  shareTarget === "message" ? "text-amber-500" : "text-slate-400"
                )}
              >
                Message
              </span>
            </button>
          </div>

          {/* Share to Timeline */}
          {shareTarget === "timeline" ? (
            <div className="px-4 mt-4">
              <p className="text-slate-400 text-sm mb-2">Add your opinion (optional)</p>
              <div className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/50">
                {me ? (
                  <div className="flex mb-3">
                    <img src={me.avatar} alt={me.displayName} className="w-10 h-10 rounded-full" />
                    <div className="ml-3">
                      <p className="text-white font-semibold">{me.displayName}</p>
                      <p className="text-slate-400 text-sm">@{me.username}</p>
                    </div>
                  </div>
                ) : null}

                <textarea
                  value={opinion}
                  onChange={(e) => setOpinion(e.target.value)}
                  placeholder="What do you think about this?"
                  className="w-full bg-transparent text-white text-base min-h-24 outline-none resize-none placeholder:text-slate-500"
                />
              </div>

              <button
                onClick={handleShareToTimeline}
                // One press, one post: the panel stays open until the server
                // has answered, so a second press cannot post it twice.
                disabled={sharing}
                className="mt-4 w-full bg-amber-500 py-4 rounded-xl flex items-center justify-center hover:bg-amber-400 transition-colors disabled:opacity-60"
              >
                <Share2 size={20} color="#0F172A" />
                <span className="text-slate-900 font-semibold text-lg ml-2">Share to My Voice</span>
              </button>
            </div>
          ) : null}

          {/* Share to Message */}
          {shareTarget === "message" ? (
            <div className="px-4 mt-4">
              <p className="text-slate-400 text-sm mb-2">Select a person to share with</p>

              <div className="max-h-64 overflow-y-auto">
                {peopleLoading ? (
                  <p className="text-slate-500 text-sm py-4 text-center">Loading people…</p>
                ) : shareTargets.length === 0 ? (
                  <p className="text-slate-500 text-sm py-4 text-center">
                    Nobody to share with yet. Follow some people first.
                  </p>
                ) : null}

                {shareTargets.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedUser(item)}
                      className={cn(
                        "w-full flex items-center p-3 rounded-xl mb-2 border text-left",
                        selectedUser?.id === item.id
                          ? "bg-amber-500/20 border-amber-500/50"
                          : "bg-slate-800/60 border-slate-700/50"
                      )}
                    >
                      <img
                        src={item.avatar}
                        alt={item.displayName}
                        className="w-12 h-12 rounded-full"
                      />
                      <div className="flex-1 ml-3">
                        <p className="text-white font-semibold">{item.displayName}</p>
                        <p className="text-slate-400 text-sm">@{item.username}</p>
                      </div>
                      {selectedUser?.id === item.id ? (
                        <span className="w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center">
                          <Check size={14} color="#0F172A" />
                        </span>
                      ) : null}
                    </button>
                  ))}
              </div>

              <button
                onClick={handleShareToMessage}
                disabled={!selectedUser || startConversation.isPending}
                className={cn(
                  "mt-4 w-full py-4 rounded-xl flex items-center justify-center",
                  selectedUser ? "bg-amber-500 hover:bg-amber-400 transition-colors" : "bg-slate-700"
                )}
              >
                <Send size={20} color={selectedUser ? "#0F172A" : "#64748B"} />
                <span
                  className={cn(
                    "font-semibold text-lg ml-2",
                    selectedUser ? "text-slate-900" : "text-slate-500"
                  )}
                >
                  Send Message
                </span>
              </button>
            </div>
          ) : null}

          {/* Copy Link */}
          <div className="px-4 pb-4 mt-4">
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center justify-center py-3 bg-slate-800/60 rounded-xl border border-slate-700/50"
            >
              {copied ? (
                <>
                  <Check size={18} color="#22C55E" />
                  <span className="text-emerald-500 font-medium ml-2">Link Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={18} color="#64748B" />
                  <span className="text-slate-400 font-medium ml-2">Copy Link</span>
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
