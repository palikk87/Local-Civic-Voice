import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { BookOpen, Scroll, Scale } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Accordion } from "@/components/ui/accordion";
import { Seal } from "@/components/civic/Seal";
import { ConstitutionArticleCard } from "@/components/documents/ConstitutionArticle";
import { RightsArticleCard } from "@/components/documents/RightsArticle";
import {
  CONSTITUTION,
  BILL_OF_RIGHTS,
  getAmendmentEnforcement,
  getConstitutionalEnforcement,
} from "@/lib/founding-documents";

export default function Documents() {
  const location = useLocation();
  const articleCount = getConstitutionalEnforcement();
  const amendmentCount = getAmendmentEnforcement();

  useEffect(() => {
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  }, [location.hash]);

  return (
    <AppShell wide>
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-primary p-8 text-center text-primary-foreground sm:p-12">
        <div className="absolute inset-0 bg-grain opacity-50" />
        <div className="relative">
          <Seal className="mx-auto h-12 w-12 text-accent" />
          <p className="mt-4 text-xs font-semibold uppercase tracking-institutional text-accent">
            The AYE & NAY
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Founding Documents
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-primary-foreground/75">
            The supreme law of the platform. All code, algorithms, and leadership
            are subordinate to these commitments — the Will of the People is the
            supreme authority.
          </p>
        </div>
      </div>

      <div className="py-10">
        {/* Constitution */}
        <section id="constitution" className="scroll-mt-24">
          <div className="flex items-center gap-3">
            <BookOpen className="h-6 w-6 text-primary" />
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              The Constitution
            </h2>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            v{CONSTITUTION.version} · Effective{" "}
            {new Date(CONSTITUTION.effectiveDate).toLocaleDateString()}
          </p>

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

          {/* Article VII — the binding glossary. */}
          <div className="mt-6 rounded-2xl border border-border bg-card p-6">
            <div className="font-mono text-xs font-semibold uppercase tracking-institutional text-accent">
              Article {CONSTITUTION.definitions.number}
            </div>
            <h3 className="font-display text-xl font-semibold text-foreground">
              {CONSTITUTION.definitions.title}
            </h3>
            <p className="mt-1 text-sm italic text-muted-foreground">
              {CONSTITUTION.definitions.note}
            </p>
            <dl className="mt-4 space-y-3 border-t border-border/60 pt-4">
              {CONSTITUTION.definitions.terms.map((entry) => (
                <div key={entry.term} className="border-l-2 border-accent/40 pl-4">
                  <dt className="font-semibold text-foreground">{entry.term}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {entry.meaning}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Bill of Rights */}
        <section id="bill-of-rights" className="mt-20 scroll-mt-24">
          <div className="flex items-center gap-3">
            <Scroll className="h-6 w-6 text-accent" />
            <h2 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              The Bill of Rights
            </h2>
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Amendments I–V · v{BILL_OF_RIGHTS.version} · Effective{" "}
            {new Date(BILL_OF_RIGHTS.effectiveDate).toLocaleDateString()}
          </p>

          <blockquote className="mt-6 rounded-2xl border border-accent/30 bg-accent/5 p-6">
            <div className="text-xs font-semibold uppercase tracking-institutional text-accent">
              Part of the Constitution
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
        </section>

        {/* Seal footer */}
        <div className="mt-16 flex flex-col items-center border-t border-border pt-10 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent/30 bg-secondary">
            <Scale className="h-7 w-7 text-accent" />
          </div>
          {/* Counted, not claimed — Article VI. */}
          <p data-testid="documents-enforced-count" className="mt-4 text-sm text-muted-foreground">
            {articleCount.enforced} of {articleCount.total} clauses and{" "}
            {amendmentCount.enforced} of {amendmentCount.total} Amendments are enforced in
            code — each one proven by a test named for it.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
