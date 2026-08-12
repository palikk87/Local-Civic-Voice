// Web port of webapp/mobile/src/app/bill-of-rights.tsx — the platform Bill of Rights.
// Content comes from the shared founding-documents lib (same text as mobile).
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Scroll, Scale } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { RightsArticleCard } from "@/components/documents/RightsArticle";
import { BILL_OF_RIGHTS } from "@/lib/founding-documents";

export default function BillOfRights() {
  const navigate = useNavigate();

  return (
    <AppShell wide>
      <div className="mx-auto max-w-3xl py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-4 -ml-2 text-muted-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20">
            <Scroll className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              The Bill of Rights
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              v{BILL_OF_RIGHTS.version} · Effective{" "}
              {new Date(BILL_OF_RIGHTS.effectiveDate).toLocaleDateString()}
            </p>
          </div>
        </div>

        <blockquote className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-6">
          <div className="text-xs font-semibold uppercase tracking-institutional text-accent">
            Preamble
          </div>
          <p className="mt-3 font-display text-lg italic leading-relaxed text-foreground">
            “{BILL_OF_RIGHTS.preamble}”
          </p>
        </blockquote>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {BILL_OF_RIGHTS.articles.map((article, i) => (
            <RightsArticleCard key={article.id} article={article} index={i} />
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center border-t border-border pt-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent/30 bg-secondary">
            <Scale className="h-6 w-6 text-accent" />
          </div>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            These rights are enshrined in code and cannot be circumvented by platform
            operators.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
