// Web port of mobile/src/app/admin/users.tsx — user management against /api/admin/users.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Ban, Trash2, ShieldCheck, Users, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader, useAdminCan } from "@/lib/mobile/admin-store";
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
  const [roleTarget, setRoleTarget] = useState<ManagedUser | null>(null);
  const [chosenRole, setChosenRole] = useState("user");

  const [convertTarget, setConvertTarget] = useState<ManagedUser | null>(null);
  const [convertType, setConvertType] = useState("research");
  const [convertTier, setConvertTier] = useState("basic");
  const [convertName, setConvertName] = useState("");
  const [issued, setIssued] = useState<{
    username: string;
    password: string;
    apiKey: string;
  } | null>(null);

  const [banTarget, setBanTarget] = useState<ManagedUser | null>(null);
  const [banReason, setBanReason] = useState<string>("");
  const [banDays, setBanDays] = useState<string>("");
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);

  // WHAT THE ROLE MAY DO, NOT WHAT IT IS CALLED. These were all one
  // `role === "superadmin"` flag, which meant an owner could grant a role
  // "users.delete" and that role would still be shown no delete button.
  const canBan = useAdminCan("users.ban");
  const canAssignRole = useAdminCan("users.assignRole");
  const canManageB2B = useAdminCan("b2b.manage");
  const canDelete = useAdminCan("users.delete");

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

  /**
   * Give somebody a business account without taking away their citizenship.
   *
   * The wording matters and the button says it: this ADDS an account. It does
   * not move their data, change their role, or mark them as a customer. Their
   * votes are a citizen's votes and stay that way — the Public Pulse is a count
   * of people, and reclassifying one would corrupt the only number this
   * platform exists to report.
   */
  /** The roles this deployment actually has, rather than three names in a dropdown. */
  const { data: rolesData } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () =>
      api.get<{ data: { roles: { slug: string; name: string }[] } }>("/api/admin/roles", {
        headers: adminAuthHeader(),
      }),
    staleTime: 60_000,
    retry: false,
  });

  /**
   * Give somebody a role, or take every administrative power away with "user".
   *
   * THE ENDPOINT THIS CALLS DID NOT EXIST until now. The mobile console has
   * had a "Grant Admin Privileges" button for weeks, calling
   * POST /api/admin/users/:id/make-admin — a route the backend does not mount.
   * It answered 404 on every press.
   */
  const roleMutation = useMutation({
    mutationFn: (input: { id: string; role: string }) =>
      api.put<{ data: { role: string; previousRole: string } }>(
        `/api/admin/users/${input.id}/role`,
        { role: input.role },
        { headers: adminAuthHeader() },
      ),
    onSuccess: (response) => {
      toast.success(
        `Role changed: ${response.data.previousRole} → ${response.data.role}`,
        { description: "Applies to their next request, not their next login." },
      );
      setRoleTarget(null);
      invalidate();
    },
    onError: (e: Error) => toast.error("Could not change the role", { description: e.message }),
  });

  const convertMutation = useMutation({
    mutationFn: (input: { userId: string; name?: string; type: string; tier: string }) =>
      api.post<{
        client: { username: string };
        credentials: { username: string; password: string; apiKey: string };
      }>("/api/admin/b2b-clients/from-user", input, { headers: adminAuthHeader() }),
    onSuccess: (response) => {
      // Shown once and unrecoverable, so it replaces the dialog rather than
      // appearing behind a toast that disappears on its own.
      setIssued(response.credentials);
      setConvertTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "b2b-clients"] });
    },
    onError: (e: Error) =>
      toast.error("Could not create the business account", { description: e.message }),
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
                {canBan ? (
                  user.isBanned ? (
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
                  )
                ) : null}
                {canAssignRole ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setRoleTarget(user);
                      setChosenRole(user.role);
                    }}
                  >
                    <ShieldCheck className="mr-1.5 h-4 w-4" />
                    Role
                  </Button>
                ) : null}
                {canManageB2B ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setConvertTarget(user);
                      setConvertName(user.displayName);
                      setConvertType("research");
                      setConvertTier("basic");
                    }}
                  >
                    <Briefcase className="mr-1.5 h-4 w-4" />
                    Business account
                  </Button>
                ) : null}
                {canDelete ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setDeleteTarget(user)}
                    aria-label={`Delete ${user.displayName || user.username || user.email}`}
                  >
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

      {/* What this person may do as an administrator */}
      <Dialog open={!!roleTarget} onOpenChange={(open) => !open && setRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Role for {roleTarget?.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              What each role may do is set under <span className="font-medium">Roles</span>. A
              change here applies to their next request, not their next sign-in.
            </p>
            <select
              value={chosenRole}
              onChange={(e) => setChosenRole(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="user">No administrative access</option>
              {(rolesData?.data.roles ?? []).map((role) => (
                <option key={role.slug} value={role.slug}>
                  {role.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The owner is not in this list. There is one, the seat is not assignable, and that
              account cannot be banned, deleted, re-keyed or re-roled by anybody.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={roleMutation.isPending || chosenRole === roleTarget?.role}
              onClick={() =>
                roleTarget && roleMutation.mutate({ id: roleTarget.id, role: chosenRole })
              }
            >
              {roleMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Give an existing account a business login */}
      <Dialog open={!!convertTarget} onOpenChange={(open) => !open && setConvertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Business account for {convertTarget?.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This adds a separate business login for the analytics portal. Their citizen account
              is untouched — same password, same votes, same posts, same role. It is a second
              account alongside theirs, not a replacement for it.
            </p>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">
                Business name (usually a company, not a person)
              </label>
              <Input
                value={convertName}
                onChange={(e) => setConvertName(e.target.value)}
                placeholder="Acme Research"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Type</label>
                <select
                  value={convertType}
                  onChange={(e) => setConvertType(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {["research", "media", "campaign", "government"].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Tier</label>
                <select
                  value={convertTier}
                  onChange={(e) => setConvertTier(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {["basic", "professional", "enterprise"].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              The login is <span className="font-mono">@{convertTarget?.username}</span> with a
              newly generated password and API key, shown once.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={!convertName.trim() || convertMutation.isPending}
              onClick={() =>
                convertTarget &&
                convertMutation.mutate({
                  userId: convertTarget.id,
                  name: convertName.trim(),
                  type: convertType,
                  tier: convertTier,
                })
              }
            >
              {convertMutation.isPending ? "Creating…" : "Create business account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The credentials, once. Not a toast: a toast that vanishes takes an
          unrecoverable secret with it. */}
      <Dialog open={!!issued} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy these now</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Stored hashed. They cannot be shown again — only rotated.
            </p>
            <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-xs">
              {`username: ${issued?.username}\npassword: ${issued?.password}\napi key : ${issued?.apiKey}`}
            </pre>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(
                    `username: ${issued?.username}\npassword: ${issued?.password}\napi key: ${issued?.apiKey}`,
                  )
                  .then(() => toast.success("Copied"))
                  .catch(() => toast.error("Could not copy — select the text and copy it manually"));
              }}
            >
              Copy
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
