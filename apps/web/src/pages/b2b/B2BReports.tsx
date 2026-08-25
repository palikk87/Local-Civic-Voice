/**
 * Export what the platform holds.
 *
 * WHAT THIS SCREEN USED TO DO. It listed three "Recent Reports" — "Weekly
 * Sentiment Summary", "Healthcare Issue Analysis", "Custom State Report - CA,
 * TX, FL" — with dates, sizes and statuses, all hardcoded, none of which had
 * ever been generated. Four "Quick Report" buttons each raised a toast reading
 * "your report is being generated, you'll receive an email when it's ready."
 * There was no job, no file, and no mailer. A client who clicked one waited for
 * something that was never coming.
 *
 * There is no queue now, and nothing is promised by email. The button fetches
 * the bytes and the browser saves them, so the thing either happens in front of
 * you or fails in front of you.
 */
import { useState } from "react";
import { Download, FileText, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { B2BShell } from "@/components/b2b/B2BShell";
import { useB2BStore } from "@/lib/mobile/b2b-store";
import { cn } from "@/lib/utils";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "";

interface Export {
  key: string;
  path: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const EXPORTS: Export[] = [
  {
    key: "records",
    path: "/api/b2b/reports/export.csv",
    title: "All records",
    description:
      "One row per bill, order and ruling, with the vote counts held for it. No estimates.",
    icon: <FileText size={22} color="#818CF8" />,
  },
  {
    key: "districts",
    path: "/api/b2b/reports/coverage.csv",
    title: "By district",
    description:
      "One row per district where members have declared themselves. Districts below the privacy floor are listed with their voice count and no opinion.",
    icon: <MapPin size={22} color="#818CF8" />,
  },
];

export default function B2BReports() {
  const session = useB2BStore((s) => s.session);
  const [busy, setBusy] = useState<string | null>(null);

  async function download(item: Export) {
    if (!session?.token) return;
    setBusy(item.key);
    try {
      const response = await fetch(`${BACKEND_URL}${item.path}`, {
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!response.ok) {
        // A failure the person can see, rather than a success they cannot check.
        toast.error("That export did not come back. Nothing was saved.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
        `${item.key}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      toast.success("Downloaded.");
    } catch {
      toast.error("That export did not come back. Nothing was saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <B2BShell title="Exports">
      <p className="-mt-4 mb-5 text-sm text-slate-400">
        Downloads immediately. Nothing is queued and nothing is emailed.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {EXPORTS.map((item) => (
          <div
            key={item.key}
            className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-5"
          >
            <div className="flex items-start">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20">
                {item.icon}
              </div>
              <div className="ml-3">
                <span className="block font-semibold text-white">{item.title}</span>
                <p className="mt-1 text-sm text-slate-400">{item.description}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void download(item)}
              disabled={busy !== null}
              className={cn(
                "mt-4 flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-indigo-500",
                busy !== null && "opacity-60",
              )}
            >
              {busy === item.key ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download CSV
            </button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-start rounded-xl border border-slate-700/50 bg-slate-800/30 p-4">
        <ShieldCheck size={16} color="#34D399" className="mt-0.5 shrink-0" />
        <p className="ml-2 text-sm text-slate-300">
          Exports contain aggregate counts only. No file names a member, and no district appears
          with an opinion attached unless enough people there have voted that no one of them can be
          singled out.
        </p>
      </div>
    </B2BShell>
  );
}
