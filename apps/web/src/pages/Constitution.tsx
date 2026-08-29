// The Constitution — Articles I–VII, then the Amendments.
// Text comes from packages/civic-core/src/constitution.ts, which both clients
// read. There is no second copy.
import { useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Scroll, Shield } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ConstitutionArticleCard } from "@/components/documents/ConstitutionArticle";
import { CONSTITUTION, getConstitutionalEnforcement } from "@/lib/founding-documents";

export default function Constitution() {
  const navigate = useNavigate();
  const { enforced, total, outstanding } = getConstitutionalEnforcement();

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

        {/*
          Article VII. A definition is not decoration — it is the difference
          between "verified" meaning a confirmed sign-up and "verified" meaning
          whatever a reader hoped it meant. The United States constitution
          defined almost nothing, and two centuries of argument followed.
        */}
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <div className="font-mono text-xs font-semibold uppercase tracking-institutional text-accent">
            Article {CONSTITUTION.definitions.number}
          </div>
          <h2 className="font-display text-xl font-semibold text-foreground">
            {CONSTITUTION.definitions.title}
          </h2>
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
        </section>

        {/* The Amendments are part of this document, so the document links to them. */}
        <button
          onClick={() => navigate("/bill-of-rights")}
          className="mt-8 w-full rounded-2xl border border-accent/30 bg-accent/5 p-6 text-left"
        >
          <div className="flex items-center gap-3">
            <Scroll className="h-6 w-6 shrink-0 text-amber-400" />
            <div>
              <div className="font-display text-lg font-semibold text-foreground">
                The Amendments — the Bill of Rights
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {CONSTITUTION.amendmentsNote}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {CONSTITUTION.amendments
                  .map((amendment) => `${amendment.number}. ${amendment.title}`)
                  .join(" · ")}
              </p>
            </div>
          </div>
        </button>

        <div className="mt-12 flex flex-col items-center border-t border-border pt-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent/30 bg-secondary">
            <Shield className="h-6 w-6 text-accent" />
          </div>
          {/* Article VI, counted rather than asserted. */}
          <p
            data-testid="articles-enforced-count"
            className="mt-4 max-w-md text-sm text-muted-foreground"
          >
            {enforced} of {total} clauses are enforced in code — each one proven by a test
            named for it, and counted here rather than typed.
          </p>
          {outstanding.length > 0 ? (
            <ul className="mt-3 text-xs text-muted-foreground">
              {outstanding.map((item) => (
                <li key={`${item.article}-${item.section}`}>
                  Not yet enforced: Article {item.article} — {item.section}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
