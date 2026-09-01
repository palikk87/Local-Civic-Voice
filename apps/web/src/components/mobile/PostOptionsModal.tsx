// Web port of mobile/src/components/PostOptionsModal.tsx
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  X,
  Trash2,
  Edit3,
  Flag,
  UserMinus,
  Share2,
  Copy,
  Bookmark,
  VolumeX,
  AlertTriangle,
} from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { type TimelinePost } from "@/lib/mobile/timeline-store";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PostOptionsModalProps {
  visible: boolean;
  onClose: () => void;
  post: TimelinePost | null;
  onDelete?: (postId: string) => void;
  onEdit?: (post: TimelinePost) => void;
  onShare?: (post: TimelinePost) => void;
  onReport?: (postId: string) => void;
  onBlock?: (userId: string) => void;
  onMute?: (userId: string) => void;
}

interface OptionItem {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  ownerOnly?: boolean;
  nonOwnerOnly?: boolean;
}

export default function PostOptionsModal({
  visible,
  onClose,
  post,
  onDelete,
  onEdit,
  onShare,
  onReport,
  onBlock,
  onMute,
}: PostOptionsModalProps) {
  // Ownership must be checked against the REAL signed-in user, not demo data —
  // otherwise your own posts show follow/report/block options that make no sense.
  const { user } = useCurrentUser();
  if (!post) return null;

  const isOwner = post.author.id === user?.id;

  const handleClose = () => {
    onClose();
  };

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  // Define all options
  const allOptions: OptionItem[] = [
    // Owner options
    {
      icon: <Edit3 size={20} color="#F59E0B" />,
      label: "Edit Post",
      onPress: () => onEdit?.(post),
      ownerOnly: true,
    },
    {
      icon: <Trash2 size={20} color="#EF4444" />,
      label: "Delete Post",
      onPress: () => onDelete?.(post.id),
      destructive: true,
      ownerOnly: true,
    },
    // Shared options (both owner and non-owner)
    {
      icon: <Share2 size={20} color="#3B82F6" />,
      label: "Share Post",
      onPress: () => onShare?.(post),
    },
    {
      icon: <Copy size={20} color="#64748B" />,
      label: "Copy Link",
      /*
       * THE LINK TO THE POST, not to the page you happen to be standing on.
       *
       * Reported plainly: "there is a button called copy link when you copy it
       * copies this https://ayeandnay.com/timeline nothing that directs you to
       * that post". It wrote window.location.href, which on the timeline is the
       * timeline — so every post on the page copied the same useless link.
       *
       * And it said nothing either way, so a copy that worked and a copy that
       * silently failed looked identical.
       */
      onPress: () => {
        const link = `${window.location.origin}/post/${post.id}`;
        navigator.clipboard
          .writeText(link)
          .then(() => toast.success("Link copied"))
          .catch(() => toast.error("Could not copy the link. Long-press to copy it instead."));
      },
    },
    {
      icon: <Bookmark size={20} color="#64748B" />,
      label: "Save Post",
      /*
       * IT SAVES NOW. This was `() => undefined` — the row was drawn, it
       * closed the sheet, and nothing happened anywhere.
       *
       * The endpoint has existed the whole time and toggles, so this reports
       * which way it went rather than assuming it saved.
       */
      onPress: () => {
        api
          .post<{ success: boolean; saved: boolean }>(`/api/feed/posts/${post.id}/save`)
          .then((answer) => {
            toast.success(answer.saved ? "Saved" : "Removed from saved");
          })
          .catch(() => toast.error("Could not save this post. Please try again."));
      },
    },
    // Non-owner options
    {
      icon: <VolumeX size={20} color="#64748B" />,
      label: `Mute @${post.author.username}`,
      onPress: () => onMute?.(post.author.id),
      nonOwnerOnly: true,
    },
    {
      icon: <UserMinus size={20} color="#F59E0B" />,
      label: `Unfollow @${post.author.username}`,
      onPress: () => undefined,
      nonOwnerOnly: true,
    },
    {
      icon: <Flag size={20} color="#EF4444" />,
      label: "Report Post",
      onPress: () => onReport?.(post.id),
      destructive: true,
      nonOwnerOnly: true,
    },
    {
      icon: <AlertTriangle size={20} color="#EF4444" />,
      label: `Block @${post.author.username}`,
      onPress: () => onBlock?.(post.author.id),
      destructive: true,
      nonOwnerOnly: true,
    },
  ];

  // Filter options based on ownership
  const visibleOptions = allOptions.filter((option) => {
    if (option.ownerOnly && !isOwner) return false;
    if (option.nonOwnerOnly && isOwner) return false;
    return true;
  });

  return (
    <Dialog open={visible} onOpenChange={(open) => (!open ? handleClose() : undefined)}>
      <DialogContent className="bg-slate-900 border-slate-800 p-0 max-w-lg flex max-h-[calc(100dvh-2rem)] w-full flex-col self-end overflow-y-auto rounded-b-none rounded-t-3xl [&>button]:hidden bg-gradient-to-b from-slate-800 to-slate-900">
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-slate-600" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <span className="text-white font-semibold text-lg">
            {isOwner ? "Manage Your Post" : "Post Options"}
          </span>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-800"
          >
            <X size={18} color="#94A3B8" />
          </button>
        </div>

        {/* Options list */}
        <div className="px-4 py-2">
          {visibleOptions.map((option, index) => (
            <MotionDiv
              key={option.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: index * 0.05 }}
            >
              <button
                onClick={() => handleAction(option.onPress)}
                className="w-full flex items-center py-4 border-b border-slate-800/50 text-left"
              >
                <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center mr-4 shrink-0">
                  {option.icon}
                </div>
                <span
                  className={cn(
                    "font-medium text-base",
                    option.destructive ? "text-red-400" : "text-white"
                  )}
                >
                  {option.label}
                </span>
              </button>
            </MotionDiv>
          ))}
        </div>

        {/* Cancel button */}
        <div className="px-4 py-4">
          <button
            onClick={handleClose}
            className="w-full py-4 rounded-xl bg-slate-800 flex items-center justify-center"
          >
            <span className="text-slate-300 font-semibold text-base">Cancel</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
