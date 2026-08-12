// Web port of mobile/src/app/admin/users.tsx — user management against /api/admin/users.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Ban, Trash2, ShieldCheck, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader, useAdminStore } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ManagedUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  joinedDate: string;
  followers: number;
  following: number;
  votesCount: number;
  postsCount: number;
  role: string;
  status: "active" | "banned";
  isBanned: boolean;
  banInfo: { reason: string; bannedAt: string; expiresAt?: string } | null;
}

interface UsersResponse {
  results: ManagedUser[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

const PAGE_SIZE = 20;

export function UsersTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const [banTarget, setBanTarget] = useState<ManagedUser | null>(null);
  const [banReason, setBanReason] = useState<string>("");
  const [banDays, setBanDays] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);

  const isSuperadmin = useAdminStore((s) => s.session?.role === "superadmin");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-users", search, offset],
    queryFn: () =>
      api.get<UsersResponse>(
        `/api/admin/users?limit=${PAGE_SIZE}&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
        { headers: adminAuthHeader() },
      ),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const banMutation = useMutation({
    mutationFn: ({ id, reason, duration }: { id: string; reason: string; duration?: number }) =>
      api.post<{ success: boolean }>(`/api/admin/users/${id}/ban`, { reason, duration }, {
        headers: adminAuthHeader(),
      }),
    onSuccess: () => {
      toast.success("User banned");
      setBanTarget(null);
      setBanReason("");
      setBanDays("");
      invalidate();
    },
    onError: (e: Error) => toast.error("Ban failed", { description: e.message }),
  });

  const unbanMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/api/admin/users/${id}/ban`, {
        headers: adminAuthHeader(),
      }),
    onSuccess: () => {
      toast.success("User unbanned");
      invalidate();
    },
    onError: (e: Error) => toast.error("Unban failed", { description: e.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/api/admin/users/${id}`, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("User deleted");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error("Delete failed", { description: e.message }),
  });

  const users = data?.results ?? [];
  const total = data?.pagination?.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            placeholder="Search by username, name, or email..."
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{total} users</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No users found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center"
            >
              <img src={user.avatar} alt="" className="h-10 w-10 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{user.displayName}</span>
                  <span className="text-sm text-muted-foreground">@{user.username}</span>
                  {user.role !== "user" ? (
                    <Badge variant="secondary" className="capitalize">
                      {user.role}
                    </Badge>
                  ) : null}
                  {user.isBanned ? <Badge variant="destructive">Banned</Badge> : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email} · joined {user.joinedDate} · {user.postsCount} posts ·{" "}
                  {user.votesCount} votes
                </p>
                {user.banInfo ? (
                  <p className="mt-0.5 text-xs text-destructive">
                    Ban reason: {user.banInfo.reason}
                    {user.banInfo.expiresAt
                      ? ` (until ${new Date(user.banInfo.expiresAt).toLocaleDateString()})`
                      : " (permanent)"}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                {user.isBanned ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => unbanMutation.mutate(user.id)}
                    disabled={unbanMutation.isPending}
                  >
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    Unban
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setBanTarget(user)}>
                    <Ban className="mr-1.5 h-4 w-4" />
                    Ban
                  </Button>
                )}
                {isSuperadmin ? (
                  <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(user)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          {total === 0 ? 0 : offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!data?.pagination?.hasMore}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next
        </Button>
      </div>

      {/* Ban Dialog */}
      <Dialog open={!!banTarget} onOpenChange={(open) => !open && setBanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {banTarget?.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Reason (required)</label>
              <Input
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                placeholder="Violation of community guidelines..."
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                Duration in days (blank = permanent)
              </label>
              <Input
                type="number"
                value={banDays}
                onChange={(e) => setBanDays(e.target.value)}
                placeholder="e.g. 7"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBanTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!banReason.trim() || banMutation.isPending}
              onClick={() =>
                banTarget &&
                banMutation.mutate({
                  id: banTarget.id,
                  reason: banReason.trim(),
                  duration: banDays ? parseInt(banDays, 10) : undefined,
                })
              }
            >
              Ban User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the account, its posts, and its votes. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
