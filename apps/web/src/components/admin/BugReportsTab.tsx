import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, Check, ChevronDown, ChevronRight, ClipboardCopy, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { adminAuthHeader } from "@/lib/mobile/admin-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * The inbox for what people report from the app.
 *
 * Open first and newest first, because a report nobody has looked at is the
 * only kind costing anything. Every state change records who made it — a queue
 * that changes anonymously is a queue nobody trusts.
 */

interface BugReport {
  id: string;
  username: string | null;
  pageUrl: string;
  pagePath: string;
  elementLabel: string | null;
  elementPath: string | null;
  /**
   * What the element actually is. Null for every report filed before this
   * existed, and for a report where nothing was pointed at.
   */
  elementDetail: {
    selector?: string;
    tag?: string;
    component?: string;
    control?: string;
    action?: string;
    attributes?: Record<string, string>;
    data?: Record<string, string>;
    html?: string;
    screen?: string;
    params?: Record<string, string>;
    tap?: string;
  } | null;
  problem: string;
  wanted: string | null;
  userAgent: string | null;
  viewport: string | null;
  appCommit: string | null;
  status: string;
  adminNote: string | null;
  resolvedBy: string | null;
  createdAt: string;
}

const FILTERS = ["open", "acknowledged", "fixed", "declined", "all"] as const;

/**
 * What the reporter was actually pointing at.
 *
 * Collapsed by default. An admin triaging a list wants the complaint; an admin
 * fixing one wants all of this, and the difference is one click.
 *
 * NOTHING HERE IS INVENTED. Every line is read off the page the person was
 * looking at, and a field the page did not carry is left out rather than
 * filled with a plausible guess.
 */
function ElementDetail({
  detail,
  path,
}: {
  detail: BugReport["elementDetail"];
  path: string | null;
}) {
  const [open, setOpen] = useState(false);

  if (!detail) {
    // Reports filed before this existed, and reports where nobody pointed at
    // anything. Say which rather than showing an empty panel.
    return path ? (
      <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{path}</p>
    ) : null;
  }

  const record = Object.entries(detail.data ?? {});
  const params = Object.entries(detail.params ?? {});
  const attributes = Object.entries(detail.attributes ?? {});

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        What it actually is
      </button>

      {open ? (
        <dl className="mt-2 space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-[11px]">
          {detail.component ? (
            <Row label="Component" value={detail.component} />
          ) : null}
          {detail.screen ? <Row label="Screen" value={detail.screen} /> : null}
          {detail.control ? <Row label="Control" value={detail.control} /> : null}
          {detail.action ? <Row label="Goes to" value={detail.action} /> : null}
          {detail.tag ? <Row label="Tag" value={detail.tag} /> : null}

          {/* THE RECORD. data-* from the element and its ancestors is where a
              bill id or a post id lives — the answer to "which one". */}
          {record.length ? (
            <Row
              label="Record"
              value={record.map(([k, v]) => `${k}=${v}`).join("  ")}
            />
          ) : null}
          {params.length ? (
            <Row label="Route params" value={params.map(([k, v]) => `${k}=${v}`).join("  ")} />
          ) : null}
          {attributes.length ? (
            <Row
              label="Attributes"
              value={attributes.map(([k, v]) => `${k}="${v}"`).join("  ")}
            />
          ) : null}
          {detail.tap ? <Row label="Tap" value={detail.tap} /> : null}
          {detail.selector ? <Row label="Selector" value={detail.selector} /> : null}

          {detail.html ? (
            <div>
              <dt className="text-muted-foreground">Markup</dt>
              <dd className="mt-0.5">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[10px] text-foreground">
                  {detail.html}
                </pre>
                <span className="text-muted-foreground">
                  Anything typed into a field is removed before this is stored.
                </span>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-foreground">{value}</dd>
    </div>
  );
}

/**
 * EVERY REPORT IN THE CURRENT FILTER, AS PLAIN TEXT.
 *
 * WHY THIS EXISTS. The queue was readable one card at a time and nowhere else.
 * Handing the whole list to somebody who can act on it — a developer, a issue
 * tracker, a colleague — meant retyping it, so in practice it did not happen
 * and reports sat in a tab nobody could get out of.
 *
 * Text rather than JSON because the destination is usually a person. Every
 * field that makes a report actionable without a round trip is here: where they
 * were, what they pointed at and what it really was, both of their answers, the
 * viewport, and the commit that was being served. The identity of the element
 * is the part that is hardest to reconstruct later and the part most often
 * needed, so it is included in full rather than summarised.
 */
function asPlainText(reports: BugReport[], filter: string): string {
  const lines: string[] = [
    `AYE & NAY — bug reports (${filter})`,
    `${reports.length} report${reports.length === 1 ? "" : "s"}, exported ${new Date().toISOString()}`,
    "",
  ];

  reports.forEach((report, index) => {
    lines.push(`--- ${index + 1} of ${reports.length} — ${report.id} ---`);
    lines.push(`status:    ${report.status}`);
    lines.push(`filed:     ${new Date(report.createdAt).toISOString()} by ${report.username ? `@${report.username}` : "a signed-out visitor"}`);
    lines.push(`page:      ${report.pagePath}  (${report.pageUrl})`);
    if (report.elementLabel) lines.push(`pointed at: ${report.elementLabel}`);
    if (report.elementPath) lines.push(`selector:  ${report.elementPath}`);

    if (report.elementDetail) {
      // The identity of the thing, not the word printed on it.
      const detail = report.elementDetail;
      const pairs: Array<[string, unknown]> = [
        ["component", detail.component],
        ["control", detail.control],
        ["action", detail.action],
        ["screen", detail.screen],
        ["tag", detail.tag],
        ["selector", detail.selector],
        ["data", detail.data && Object.keys(detail.data).length ? detail.data : undefined],
        ["params", detail.params && Object.keys(detail.params).length ? detail.params : undefined],
      ];
      for (const [key, value] of pairs) {
        if (value === undefined || value === null || value === "") continue;
        lines.push(`  ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
      }
    }

    lines.push(`problem:   ${report.problem}`);
    // The second answer is the useful one and is often empty; say so rather
    // than leaving a blank line somebody has to interpret.
    lines.push(`wanted:    ${report.wanted || "(not answered)"}`);
    lines.push(`viewport:  ${report.viewport ?? "unknown"}   commit: ${report.appCommit?.slice(0, 7) ?? "unknown"}`);
    if (report.userAgent) lines.push(`browser:   ${report.userAgent}`);
    if (report.adminNote) lines.push(`note:      ${report.adminNote}`);
    if (report.resolvedBy) lines.push(`resolved by: ${report.resolvedBy}`);
    lines.push("");
  });

  return lines.join("\n");
}

export function BugReportsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("open");
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "bug-reports", filter],
    queryFn: () =>
      api.get<{ reports: BugReport[]; total: number; openCount: number }>(
        `/api/admin/bug-reports?status=${filter}`,
        { headers: adminAuthHeader() },
      ),
  });

  const triage = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/api/admin/bug-reports/${id}`, { status }, { headers: adminAuthHeader() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "bug-reports"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not update that report"),
  });

  /**
   * navigator.clipboard is unavailable on an insecure origin and can be refused
   * by the browser even on a secure one. Falling back to a selected textarea
   * keeps the button working rather than failing silently, and if BOTH fail the
   * text goes to the console so it is still recoverable.
   */
  async function copyAll() {
    const reports = data?.reports ?? [];
    if (!reports.length) return;
    const text = asPlainText(reports, filter);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      if (!ok) {
        console.log(text);
        toast.error("Could not reach the clipboard — the reports are in the browser console");
        return;
      }
    }

    setCopied(true);
    toast.success(`${reports.length} report${reports.length === 1 ? "" : "s"} copied`);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Bug className="h-4 w-4 text-amber-500" />
        <span className="font-semibold text-foreground">Bug reports</span>
        {data?.openCount ? (
          <Badge variant="secondary">{data.openCount} open</Badge>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1">
          {FILTERS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
              className="capitalize"
            >
              {value}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copyAll()}
            disabled={!data?.reports.length}
            title="Copy every report in this filter as plain text"
          >
            <ClipboardCopy className="mr-1 h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy all"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data?.reports.length ? (
        <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {filter === "open" ? "Nothing open. " : "Nothing here. "}
          Reports arrive from the bug button on every page.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.reports.map((report) => (
            <li key={report.id} className="rounded-lg border border-border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={report.status === "open" ? "default" : "secondary"}>
                  {report.status}
                </Badge>
                <span>{new Date(report.createdAt).toLocaleString()}</span>
                <span>·</span>
                <span>{report.username ? `@${report.username}` : "signed out"}</span>
                <a
                  href={report.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-amber-500 hover:underline"
                >
                  {report.pagePath}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {report.elementLabel ? (
                <p className="mb-2 text-sm">
                  <span className="text-muted-foreground">Pointed at </span>
                  <span className="font-medium text-foreground">“{report.elementLabel}”</span>
                  {report.elementDetail?.component ? (
                    <span className="text-muted-foreground">
                      {" "}
                      in <span className="font-mono text-foreground">
                        {report.elementDetail.component}
                      </span>
                    </span>
                  ) : null}
                </p>
              ) : null}

              <p className="text-sm text-foreground">{report.problem}</p>
              {report.wanted ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Wanted: </span>
                  {report.wanted}
                </p>
              ) : null}

              {/* WHAT IT ACTUALLY IS, not just what it said.
                  The label above is the word on the screen, which the
                  complaint already contains. This is the part that says which
                  one, on which record, rendered by what. */}
              <ElementDetail detail={report.elementDetail} path={report.elementPath} />

              {/* The two things that decide whether this is reproducible. */}
              <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">
                {[report.viewport, report.appCommit?.slice(0, 7)].filter(Boolean).join(" · ")}
              </p>

              {report.resolvedBy ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Closed by {report.resolvedBy}
                </p>
              ) : (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={triage.isPending}
                    onClick={() => triage.mutate({ id: report.id, status: "acknowledged" })}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={triage.isPending}
                    onClick={() => triage.mutate({ id: report.id, status: "fixed" })}
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Fixed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={triage.isPending}
                    onClick={() => triage.mutate({ id: report.id, status: "declined" })}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
