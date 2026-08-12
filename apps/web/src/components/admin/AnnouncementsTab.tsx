// Web port of mobile/src/app/admin/announcements.tsx — system announcements.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: "low" | "medium" | "high" | "critical";
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
  isActive: boolean;
}

interface AnnouncementsResponse {
  results: Announcement[];
  pagination: { total: number };
}

const PRIORITY_BADGE: Record<Announcement["priority"], string> = {
  low: "bg-slate-500/20 text-slate-500",
  medium: "bg-blue-500/20 text-blue-500",
  high: "bg-amber-500/20 text-amber-500",
  critical: "bg-red-500/20 text-red-500",
};

export function AnnouncementsTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState<boolean>(false);
  const [title, setTitle] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [priority, setPriority] = useState<Announcement["priority"]>("medium");
  const [expiresDays, setExpiresDays] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: () =>
      api.get<AnnouncementsResponse>("/api/admin/announcements", { headers: adminAuthHeader() }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean }>(
        "/api/admin/announce",
        {
          title: title.trim(),
          content: content.trim(),
          priority,
          ...(expiresDays
            ? {
                expiresAt: new Date(
                  Date.now() + parseInt(expiresDays, 10) * 24 * 60 * 60 * 1000,
                ).toISOString(),
              }
            : {}),
        },
        { headers: adminAuthHeader() },
      ),
    onSuccess: () => {
      toast.success("Announcement published");
      setShowCreate(false);
      setTitle("");
      setContent("");
      setPriority("medium");
      setExpiresDays("");
      queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
    },
    onError: (e: Error) => toast.error("Publish failed", { description: e.message }),
  });

  const announcements = data?.results ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {announcements.length} announcement{announcements.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New Announcement
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <Megaphone className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">
            No announcements yet — publish one to notify the community
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{a.title}</span>
                <Badge className={PRIORITY_BADGE[a.priority]} variant="secondary">
                  {a.priority}
                </Badge>
                {!a.isActive ? <Badge variant="outline">Inactive</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-foreground/90">{a.content}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                By {a.createdBy} on {new Date(a.createdAt).toLocaleString()}
                {a.expiresAt ? ` · expires ${new Date(a.expiresAt).toLocaleDateString()}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">Content</label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={4}
                maxLength={2000}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">Priority</label>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as Announcement["priority"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">
                  Expires in days (optional)
                </label>
                <Input
                  type="number"
                  value={expiresDays}
                  onChange={(e) => setExpiresDays(e.target.value)}
                  placeholder="e.g. 7"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              disabled={!title.trim() || !content.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Publish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
