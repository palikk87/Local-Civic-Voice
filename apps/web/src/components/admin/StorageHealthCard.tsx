// Account storage health. Mirrors the mobile admin dashboard's storage panel and
// reads the same /api/admin/storage-health endpoint.
//
// Accounts live in Supabase Postgres, outside the app container, so they survive
// restarts on their own. This panel confirms that live — the database the app is
// actually connected to, and how many accounts are in it. The old "back up now"
// button and vault counters are gone with the vault they belonged to.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface StorageHealth {
  databaseDurable: boolean;
  databaseKind: string;
  totalUsers: number;
  realAccounts: number;
  accountsProtected: boolean;
  warning: string | null;
}

export function StorageHealthCard() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-storage-health"],
    queryFn: () =>
      api.get<{ data: StorageHealth }>("/api/admin/storage-health", {
        headers: adminAuthHeader(),
      }),
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-3 h-8 w-24" />
      </div>
    );
  }

  const health = data?.data;
  if (!health) return null;

  const protected_ = health.accountsProtected;

  return (
    <div
      className={`rounded-lg border p-4 ${
        protected_
          ? "border-border bg-card"
          : "border-destructive/50 bg-destructive/5"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {protected_ ? (
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          )}
          <div>
            <h3 className="text-sm font-semibold text-foreground">Account Storage</h3>
            <p className="text-xs text-muted-foreground">
              {protected_ ? "Accounts are safe and permanent" : "Accounts are at risk"}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void queryClient.invalidateQueries({ queryKey: ["admin-storage-health"] })
          }
          disabled={isFetching}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Database</dt>
          <dd className="font-medium text-foreground">{health.databaseKind}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Survives restarts</dt>
          <dd className="font-medium text-foreground">
            {health.databaseDurable ? "Yes" : "No"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Sign-in accounts</dt>
          <dd className="font-medium text-foreground">{health.realAccounts}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Total profiles</dt>
          <dd className="font-medium text-foreground">{health.totalUsers}</dd>
        </div>
      </dl>

      {health.warning ? (
        <p className="mt-3 rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
          {health.warning}
        </p>
      ) : null}
    </div>
  );
}
