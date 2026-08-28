import { Code2 } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import type { RightsArticle as ArticleType } from "@/lib/founding-documents";

/**
 * An Amendment, as a card.
 *
 * WHAT WENT. Each of these used to carry four bullets under "Enforced
 * principles" — hand-typed lines with a green tick beside them. Two of the
 * twenty were false ("Encrypted personal data", "Trust Score determines
 * influence"), and none of the twenty was checked by anything. A tick that
 * cannot fail is decoration.
 *
 * In their place is the one badge that has to be earned: an Amendment may
 * claim enforcement only if a test under backend/tests names it, which is
 * Article VI and is checked by constitution-enforced.test.ts.
 */
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
            Amendment {article.number}
          </div>
          <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
            {article.title}
          </h3>
          <p className="text-sm italic text-muted-foreground">{article.subtitle}</p>
        </div>
      </div>

      <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-foreground/90">
        {article.content}
      </p>

      {article.enforcedInCode ? (
        <div className="mt-4 border-t border-border/60 pt-4">
          <span
            data-testid="amendment-enforced"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-support"
          >
            <Code2 className="h-3.5 w-3.5" /> Enforced in code
          </span>
        </div>
      ) : (
        <div className="mt-4 border-t border-border/60 pt-4">
          <span className="text-xs font-medium text-muted-foreground">
            Not yet enforced in code
          </span>
        </div>
      )}
    </MotionDiv>
  );
}
