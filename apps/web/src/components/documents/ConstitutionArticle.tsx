import { Code2 } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { ConstitutionArticle as ArticleType } from "@/lib/founding-documents";

export function ConstitutionArticleCard({ article }: { article: ArticleType }) {
  const Icon = article.icon;
  return (
    <AccordionItem
      value={article.id}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <AccordionTrigger className="px-5 py-4 hover:no-underline sm:px-6">
        <div className="flex items-center gap-4 text-left">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <div className="font-mono text-xs font-semibold uppercase tracking-institutional text-accent">
              Article {article.number}
            </div>
            <div className="font-display text-lg font-semibold text-foreground">
              {article.title}
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-5 pb-5 sm:px-6">
        <div className="space-y-4 border-t border-border/60 pt-4">
          {article.sections.map((section) => (
            <div
              key={section.id}
              className="border-l-2 border-accent/40 pl-4"
            >
              <h4 className="font-semibold text-foreground">{section.title}</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {section.content}
              </p>
              {section.enforcedInCode ? (
                <span className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-support">
                  <Code2 className="h-3.5 w-3.5" /> Enforced in code
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
