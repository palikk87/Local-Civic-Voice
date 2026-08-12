// Web port of webapp/mobile/src/app/constitution.tsx — the platform Constitution.
// Content comes from the shared founding-documents lib (same text as mobile).
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Shield } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ConstitutionArticleCard } from "@/components/documents/ConstitutionArticle";
import { CONSTITUTION } from "@/lib/founding-documents";

export default function Constitution() {
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
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-500/20">
            <BookOpen className="h-6 w-6 text-slate-300" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              The Constitution
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              v{CONSTITUTION.version} · Effective{" "}
              {new Date(CONSTITUTION.effectiveDate).toLocaleDateString()}
            </p>
          </div>
        </div>

        <blockquote className="mt-6 rounded-2xl border border-border bg-secondary/40 p-6">
          <div className="text-xs font-semibold uppercase tracking-institutional text-accent">
            Preamble
          </div>
          <p className="mt-3 font-display text-lg italic leading-relaxed text-foreground">
            “{CONSTITUTION.preamble}”
          </p>
        </blockquote>

        <Accordion type="single" collapsible className="mt-6 space-y-3">
          {CONSTITUTION.articles.map((article) => (
            <ConstitutionArticleCard key={article.id} article={article} />
          ))}
        </Accordion>

        <div className="mt-12 flex flex-col items-center border-t border-border pt-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent/30 bg-secondary">
            <Shield className="h-6 w-6 text-accent" />
          </div>
          <p className="mt-4 max-w-md text-sm text-muted-foreground">
            The supreme law of the platform. All code, algorithms, and leadership are
            subordinate to these commitments.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
