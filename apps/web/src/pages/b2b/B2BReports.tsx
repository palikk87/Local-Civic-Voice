// Web port of webapp/mobile/src/app/b2b/reports.tsx — report generation.
import { useState, type ReactNode } from "react";
import {
  FileText,
  Download,
  Calendar,
  X,
  CheckCircle,
  Clock,
  Mail,
  Building2,
  Target,
  Map,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { B2BShell } from "@/components/b2b/B2BShell";
import { cn } from "@/lib/utils";

interface GeneratedReportProps {
  id: string;
  title: string;
  generatedAt: string;
  status: "completed" | "processing" | "failed";
  format: "pdf" | "csv";
}

function ReportTemplate({
  title,
  description,
  icon,
  onGenerate,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  onGenerate: () => void;
}) {
  return (
    <button
      onClick={onGenerate}
      className="mb-3 w-full rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 text-left transition-colors hover:bg-slate-800/60"
    >
      <div className="flex items-start">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/20">
          {icon}
        </div>
        <div className="ml-3 flex-1">
          <span className="block text-base font-semibold text-white">{title}</span>
          <span className="mt-1 block text-sm text-slate-400">{description}</span>
        </div>
        <div className="rounded-lg bg-indigo-500/20 p-2">
          <Download size={18} color="#818CF8" />
        </div>
      </div>
    </button>
  );
}

function GeneratedReport({ title, generatedAt, status }: GeneratedReportProps) {
  const statusStyle =
    status === "completed"
      ? { icon: <CheckCircle size={16} color="#34D399" />, text: "text-emerald-400", bg: "bg-emerald-500/10" }
      : status === "processing"
        ? { icon: <Clock size={16} color="#FBBF24" />, text: "text-amber-400", bg: "bg-amber-500/10" }
        : { icon: <X size={16} color="#EF4444" />, text: "text-red-400", bg: "bg-red-500/10" };

  return (
    <div className="flex items-center justify-between border-b border-slate-700/30 py-3 last:border-b-0">
      <div className="flex flex-1 items-center">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", statusStyle.bg)}>
          <FileText size={20} color="#818CF8" />
        </div>
        <div className="ml-3 flex-1">
          <span className="block font-medium text-white">{title}</span>
          <span className="block text-xs text-slate-400">{generatedAt}</span>
        </div>
      </div>
      <div className="flex items-center">
        <span className={cn("mr-2 rounded-full px-2 py-1 text-xs capitalize", statusStyle.bg, statusStyle.text)}>
          {status}
        </span>
        {status === "completed" ? (
          <button className="rounded-lg bg-slate-700/50 p-2" aria-label={`Download ${title}`}>
            <Download size={16} color="#94A3B8" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

const GENERATED_REPORTS: GeneratedReportProps[] = [
  {
    id: "1",
    title: "Weekly Sentiment Summary",
    generatedAt: "Mar 3, 2026 at 9:00 AM",
    status: "completed",
    format: "pdf",
  },
  {
    id: "2",
    title: "Healthcare Issue Analysis",
    generatedAt: "Mar 2, 2026 at 3:30 PM",
    status: "completed",
    format: "pdf",
  },
  {
    id: "3",
    title: "Custom State Report - CA, TX, FL",
    generatedAt: "Mar 1, 2026 at 11:00 AM",
    status: "processing",
    format: "csv",
  },
];

const STATES = ["CA", "TX", "FL", "NY", "PA", "OH", "GA", "NC", "MI", "AZ"];
const ISSUES = ["Healthcare", "Immigration", "Economy", "Climate", "Education", "Crime"];

export default function B2BReports() {
  const [showCustomReport, setShowCustomReport] = useState<boolean>(false);
  const [dateRange, setDateRange] = useState<string>("7");
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const [reportFormat, setReportFormat] = useState<"pdf" | "csv">("pdf");
  const [email, setEmail] = useState<string>("");

  const reportTemplates = [
    {
      title: "Executive Summary",
      description: "High-level overview of platform sentiment and key metrics",
      icon: <TrendingUp size={24} color="#818CF8" />,
    },
    {
      title: "Geographic Analysis",
      description: "State and district-level sentiment breakdown",
      icon: <Map size={24} color="#818CF8" />,
    },
    {
      title: "Issue Deep Dive",
      description: "Comprehensive analysis of specific policy issues",
      icon: <Target size={24} color="#818CF8" />,
    },
    {
      title: "Competitive Intelligence",
      description: "Compare sentiment across multiple issues or bills",
      icon: <Building2 size={24} color="#818CF8" />,
    },
  ];

  const handleGenerateReport = (template: string) => {
    toast.success("Report Queued", {
      description: `Your ${template} report is being generated. You'll receive an email when it's ready.`,
    });
  };

  const handleCustomReport = () => {
    if (!email) {
      toast.error("Email Required", {
        description: "Please enter an email address to receive the report.",
      });
      return;
    }

    setShowCustomReport(false);
    toast.success("Custom Report Queued", {
      description: `Your custom report is being generated and will be sent to ${email}`,
    });
  };

  return (
    <B2BShell title="Reports">
      <div className="-mt-4 mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">Generate custom analytics reports</p>
        <button
          onClick={() => setShowCustomReport(true)}
          className="rounded-xl bg-indigo-500 px-4 py-2 font-medium text-white transition-colors hover:bg-indigo-600"
        >
          Custom
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <span className="mb-3 block text-lg font-bold text-white">Quick Reports</span>
          {reportTemplates.map((template, index) => (
            <ReportTemplate
              key={index}
              title={template.title}
              description={template.description}
              icon={template.icon}
              onGenerate={() => handleGenerateReport(template.title)}
            />
          ))}
        </div>

        <div>
          <span className="mb-3 block text-lg font-bold text-white">Recent Reports</span>
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4">
            {GENERATED_REPORTS.map((report) => (
              <GeneratedReport key={report.id} {...report} />
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
            <div className="mb-2 flex items-center">
              <Calendar size={16} color="#818CF8" />
              <span className="ml-2 font-medium text-indigo-300">Scheduled Reports</span>
            </div>
            <p className="text-sm text-slate-300">
              Set up automated weekly or monthly reports to be delivered to your inbox.
              Contact your account manager to configure scheduled reporting.
            </p>
          </div>
        </div>
      </div>

      {/* Custom Report Dialog */}
      <Dialog open={showCustomReport} onOpenChange={setShowCustomReport}>
        <DialogContent className="max-h-[85vh] overflow-y-auto border-slate-700 bg-slate-800 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">Custom Report</DialogTitle>
          </DialogHeader>

          <span className="text-slate-400">Date Range</span>
          <div className="mb-4 flex gap-2">
            {["7", "14", "30", "90"].map((days) => (
              <button
                key={days}
                onClick={() => setDateRange(days)}
                className={cn(
                  "flex-1 rounded-xl py-3 text-center",
                  dateRange === days ? "bg-indigo-500 font-medium text-white" : "bg-slate-700 text-slate-300",
                )}
              >
                {days}d
              </button>
            ))}
          </div>

          <span className="text-slate-400">States (Optional)</span>
          <div className="mb-4 flex flex-wrap gap-2">
            {STATES.map((state) => (
              <button
                key={state}
                onClick={() =>
                  setSelectedStates((prev) =>
                    prev.includes(state) ? prev.filter((s) => s !== state) : [...prev, state],
                  )
                }
                className={cn(
                  "rounded-full px-4 py-2 text-sm",
                  selectedStates.includes(state) ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-300",
                )}
              >
                {state}
              </button>
            ))}
          </div>

          <span className="text-slate-400">Issues (Optional)</span>
          <div className="mb-4 flex flex-wrap gap-2">
            {ISSUES.map((issue) => (
              <button
                key={issue}
                onClick={() =>
                  setSelectedIssues((prev) =>
                    prev.includes(issue) ? prev.filter((i) => i !== issue) : [...prev, issue],
                  )
                }
                className={cn(
                  "rounded-full px-4 py-2 text-sm",
                  selectedIssues.includes(issue) ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-300",
                )}
              >
                {issue}
              </button>
            ))}
          </div>

          <span className="text-slate-400">Format</span>
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => setReportFormat("pdf")}
              className={cn(
                "flex-1 rounded-xl py-3 text-center",
                reportFormat === "pdf" ? "bg-indigo-500 font-medium text-white" : "bg-slate-700 text-slate-300",
              )}
            >
              PDF Report
            </button>
            <button
              onClick={() => setReportFormat("csv")}
              className={cn(
                "flex-1 rounded-xl py-3 text-center",
                reportFormat === "csv" ? "bg-indigo-500 font-medium text-white" : "bg-slate-700 text-slate-300",
              )}
            >
              CSV Data
            </button>
          </div>

          <span className="text-slate-400">Delivery Email</span>
          <div className="mb-4 flex items-center rounded-xl bg-slate-700 px-4">
            <Mail size={20} color="#64748B" />
            <input
              className="flex-1 bg-transparent px-3 py-3 text-white outline-none placeholder:text-slate-500"
              placeholder="Enter email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <button
            onClick={handleCustomReport}
            className="w-full rounded-xl bg-indigo-500 py-4 font-bold text-white transition-colors hover:bg-indigo-600"
          >
            Generate Report
          </button>
        </DialogContent>
      </Dialog>
    </B2BShell>
  );
}
