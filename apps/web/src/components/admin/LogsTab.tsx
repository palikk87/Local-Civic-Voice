// Web port of mobile/src/app/admin/logs.tsx — admin activity log.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ActivityLog {
  id: string;
  action: string;
  adminId: string;
  adminUsername: string;
  targetType: "user" | "post" | "comment" | "system";
  targetId?: string;
  details: string;
  createdAt: string;
}

interface LogsResponse {
  results: ActivityLog[];
  pagination: { total: number };
}

const TARGET_BADGE: Record<string, string> = {
  user: "bg-blue-500/20 text-blue-500",
  post: "bg-amber-500/20 text-amber-500",
  comment: "bg-purple-500/20 text-purple-500",
  system: "bg-slate-500/20 text-slate-500",
};

export function LogsTab() {
  const [targetType, setTargetType] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-logs", targetType],
    queryFn: () =>
      api.get<LogsResponse>(
        `/api/admin/logs?limit=50${targetType !== "all" ? `&targetType=${targetType}` : ""}`,
        { headers: adminAuthHeader() },
      ),
  });

  const logs = data?.results ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {data?.pagination?.total ?? 0} log entries
        </span>
        <Select value={targetType} onValueChange={setTargetType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All targets</SelectItem>
            <SelectItem value="user">Users</SelectItem>
            <SelectItem value="post">Posts</SelectItem>
            <SelectItem value="comment">Comments</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <ScrollText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No activity logged yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex flex-col gap-1 border-b border-border p-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-3"
            >
              <Badge
                variant="secondary"
                className={`w-fit shrink-0 ${TARGET_BADGE[log.targetType] ?? ""}`}
              >
                {log.action.replace(/_/g, " ")}
              </Badge>
              <p className="min-w-0 flex-1 text-sm text-foreground/90">{log.details}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {log.adminUsername} · {new Date(log.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
