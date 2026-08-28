// Web port of mobile/src/app/admin/posts.tsx — post moderation against /api/admin/posts.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar, PersonHandle, PersonName } from "@/components/people/PersonLink";
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

interface ManagedPost {
  id: string;
  content: string;
  authorId: string;
  author: { id: string; displayName: string; username: string; avatar: string };
  createdAt: string;
  likes: number;
  commentsCount: number;
  status: string;
  reportCount: number;
}

interface PostsResponse {
  results: ManagedPost[];
  pagination: { total: number; limit: number; offset: number; hasMore: boolean };
}

const PAGE_SIZE = 20;

export function PostsTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState<string>("");
  const [offset, setOffset] = useState<number>(0);
  const [deleteTarget, setDeleteTarget] = useState<ManagedPost | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-posts", search, offset],
    queryFn: () =>
      api.get<PostsResponse>(
        `/api/admin/posts?limit=${PAGE_SIZE}&offset=${offset}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
        { headers: adminAuthHeader() },
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(`/api/admin/posts/${id}`, { headers: adminAuthHeader() }),
    onSuccess: () => {
      toast.success("Post removed");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-posts"] });
    },
    onError: (e: Error) => toast.error("Delete failed", { description: e.message }),
  });

  const posts = data?.results ?? [];
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
            placeholder="Search post content..."
            className="pl-9"
          />
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{total} posts</span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No posts found</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {posts.map((post) => (
            <div
              key={post.id}
              className="flex items-start gap-3 border-b border-border p-4 last:border-b-0"
            >
              {/* An admin reading a reported post needs to see who wrote it,
                  which is one click away on their public profile — and it is
                  the same rule as everywhere else, so this needs no exception
                  to it. */}
              <PersonAvatar person={post.author} className="h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    <PersonName person={post.author} />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    <PersonHandle person={post.author} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(post.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">
                  {post.content}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {post.likes} likes · {post.commentsCount} comments
                  {post.reportCount > 0 ? ` · ${post.reportCount} reports` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="shrink-0"
                onClick={() => setDeleteTarget(post)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

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

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this post?</AlertDialogTitle>
            <AlertDialogDescription>
              The post by @{deleteTarget?.author?.username} will be permanently removed from the
              platform.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Remove post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
