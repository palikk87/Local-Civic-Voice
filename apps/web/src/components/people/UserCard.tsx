// Web port of UserCard in webapp/mobile/src/app/(tabs)/people.tsx
// Follows go through the real backend (/api/users/:id/follow) instead of the
// hard-disabled Supabase client the mobile screen still references.
import { useState } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import { useFollowUser, useUnfollowUser } from "@/lib/mobile/api-hooks";
import { useAuthUI } from "@/hooks/use-civic-auth";
import type { User } from "@/lib/mobile/types";
import { cn } from "@/lib/utils";

interface UserCardProps {
  user: User;
  currentUserId?: string;
  onPress: () => void;
  onFollowChange?: () => void;
}

export function UserCard({ user, currentUserId, onPress, onFollowChange }: UserCardProps) {
  const [isFollowing, setIsFollowing] = useState<boolean>(user.isFollowing ?? false);
  const { openAuth } = useAuthUI();
  const followMutation = useFollowUser();
  const unfollowMutation = useUnfollowUser();
  const isProcessing = followMutation.isPending || unfollowMutation.isPending;

  const handleFollowPress = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUserId) {
      openAuth("Sign in to follow other citizens");
      return;
    }

    try {
      if (isFollowing) {
        await unfollowMutation.mutateAsync(user.id);
        setIsFollowing(false);
      } else {
        await followMutation.mutateAsync(user.id);
        setIsFollowing(true);
      }
      onFollowChange?.();
    } catch (error) {
      console.error("Follow action failed:", error);
    }
  };

  // Don't show follow button for own profile
  const showFollowButton = currentUserId !== user.id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPress}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onPress();
      }}
      className="mb-3 cursor-pointer rounded-2xl bg-card p-4 transition-colors hover:bg-muted/60"
    >
      <div className="flex items-center">
        <img
          src={user.avatar}
          alt={user.displayName}
          className="h-14 w-14 shrink-0 rounded-full bg-muted object-cover"
        />
        <div className="ml-3 min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-foreground">{user.displayName}</p>
          <p className="truncate text-sm text-muted-foreground">@{user.username}</p>
          {user.bio ? (
            <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{user.bio}</p>
          ) : null}
        </div>
        <div className="ml-2 flex flex-col items-end">
          {showFollowButton ? (
            <button
              type="button"
              onClick={handleFollowPress}
              disabled={isProcessing}
              className={cn(
                "flex min-h-[36px] items-center rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                isFollowing
                  ? "bg-muted text-foreground hover:bg-muted/80"
                  : "bg-amber-500 text-slate-900 hover:bg-amber-400",
              )}
            >
              {isProcessing ? (
                <Loader2 className={cn("h-4 w-4 animate-spin", isFollowing ? "text-amber-500" : "text-slate-900")} />
              ) : isFollowing ? (
                "Following"
              ) : (
                <>
                  <UserPlus size={14} color="#0F172A" strokeWidth={2.5} />
                  <span className="ml-1">Follow</span>
                </>
              )}
            </button>
          ) : null}
          <span className="mt-2 text-xs text-muted-foreground/70">
            {(user.followers ?? 0).toLocaleString()} followers
          </span>
        </div>
      </div>
    </div>
  );
}
