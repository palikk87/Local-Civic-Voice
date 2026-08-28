import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { adminAuthHeader, useAdminCan } from "@/lib/mobile/admin-store";

/**
 * WHAT IS BROKEN, WHAT IS CARRYING IT, AND HAS ANYBODY SEEN IT.
 *
 * WHY THIS SCREEN EXISTS. The Citizen's Brief went down three times, each time
 * because the model it called stopped being served under that name. Each time
 * the only record was a log line on a host nobody reads, and what reached a
 * person was "try again shortly" — advice that could never come true.
 *
 * The platform now falls over to another model and keeps working. That is the
 * right behaviour and it is ALSO how a problem hides for a month, getting
 * quietly worse answers, until the safety net goes too. So a fallback is not a
 * silent success: it opens a row, and the row sits here until somebody clears
 * it.
 *
 * "SEEN" IS NOT "FIXED", and the button says so. The platform cannot know
 * whether a person actually dealt with the cause, so an acknowledged incident
 * re-opens by itself the next time it happens.
 */

interface Incident {
  id: string;
  kind: string;
  subject: string;
  fallback: string | null;
  detail: string;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

interface IncidentsResponse {
  data: {
    incidents: Incident[];
    open: number;
    models: { model: string; provider: string; struckOff: boolean }[];
    note: string;
  };
}

const WHAT_IT_MEANS: Record<string, string> = {
  ai_model_unusable:
    "The provider refused this model. Something else is writing the briefs in the meantime.",
  ai_all_models_failed:
    "Every model refused. No brief can be written until this is dealt with — this is the outage itself, not a workaround.",
};

export function IncidentsCard() {
  const canManage = useAdminCan("incidents.manage");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "incidents"],
    queryFn: () => api.get<IncidentsResponse>("/api/admin/incidents", { headers: adminAuthHeader() }),
    enabled: canManage,
    // Short, because this is the screen somebody stares at during an outage.
    refetchInterval: 60_000,
  });

  if (!canManage) return null;

  async function acknowledge(id: string) {
    setBusy(id);
    try {
      await api.post(`/api/admin/incidents/${id}/acknowledge`, {}, { headers: adminAuthHeader() });
      await queryClient.invalidateQueries({ queryKey: ["admin", "incidents"] });
    } finally {
      setBusy(null);
    }
  }

  const incidents = data?.data.incidents ?? [];
  const open = incidents.filter((incident) => !incident.acknowledgedAt);

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center gap-2">
        <LifeBuoy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium text-foreground">Running on a safety net</p>
        {open.length > 0 ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500">
            {open.length} open
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Things that failed and are being worked around. A fallback keeps the platform running;
        it does not fix the cause.
      </p>

      {isLoading ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : incidents.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-emerald-500">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Nothing is running on a fallback.
        </div>
      ) : (
        <ul className="mt-3 space-y-3">
          {incidents.map((incident) => (
            <li
              key={incident.id}
              className={
                incident.acknowledgedAt
                  ? "rounded-md border border-border p-3 opacity-70"
                  : "rounded-md border border-amber-500/40 bg-amber-500/5 p-3"
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-mono text-sm text-foreground">
                    {!incident.acknowledgedAt ? (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                    ) : null}
                    {incident.subject}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {WHAT_IT_MEANS[incident.kind] ?? incident.kind}
                  </p>
                  {incident.fallback ? (
                    <p className="mt-1 text-sm text-foreground">
                      Carrying it now: <span className="font-mono">{incident.fallback}</span>
                    </p>
                  ) : null}
                  <p className="mt-1 break-words text-xs text-muted-foreground">{incident.detail}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {incident.occurrences} time{incident.occurrences === 1 ? "" : "s"} · first{" "}
                    {new Date(incident.firstSeenAt).toLocaleString()} · last{" "}
                    {new Date(incident.lastSeenAt).toLocaleString()}
                  </p>
                  {incident.acknowledgedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Seen by {incident.acknowledgedBy ?? "an admin"} on{" "}
                      {new Date(incident.acknowledgedAt).toLocaleDateString()} — it will re-open
                      here if it happens again.
                    </p>
                  ) : null}
                </div>
                {!incident.acknowledgedAt ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy === incident.id}
                    onClick={() => void acknowledge(incident.id)}
                  >
                    {busy === incident.id ? "…" : "Mark seen"}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {data?.data.models.length ? (
        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs font-medium text-foreground">Models, best first</p>
          <ul className="mt-1 space-y-0.5">
            {data.data.models.map((model) => (
              <li key={model.model} className="font-mono text-xs text-muted-foreground">
                {model.model}
                {model.struckOff ? (
                  <span className="ml-2 font-sans text-amber-500">
                    not being tried — the provider refused it
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{data.data.note}</p>
        </div>
      ) : null}
    </div>
  );
}
