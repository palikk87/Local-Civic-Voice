import { CheckCircle2 } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { RightsArticle as ArticleType } from "@/lib/founding-documents";

export function RightsArticleCard({
  article,
  index,
}: {
  article: ArticleType;
  index: number;
}) {
  const Icon = article.icon;
  return (
    <MotionDiv
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay: (index % 2) * 0.08 }}
      className="rounded-2xl border border-border bg-card p-6"
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="font-mono text-xs font-semibold uppercase tracking-institutional text-accent">
            Article {article.number}
          </div>
          <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
            {article.title}
          </h3>
          <p className="text-sm italic text-muted-foreground">{article.subtitle}</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-foreground/90">
        {article.content}
      </p>

      <div className="mt-4 border-t border-border/60 pt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Enforced principles
        </div>
        <ul className="mt-2 space-y-1.5">
          {article.principles.map((p) => (
            <li key={p} className="flex items-center gap-2 text-sm text-foreground/80">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-support" /> {p}
            </li>
          ))}
        </ul>
      </div>
    </MotionDiv>
  );
}
