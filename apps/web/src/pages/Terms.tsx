import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "@/lib/legal/terms";

/**
 * The Terms of Use, read from the shared content module so this page and the
 * first-visit acceptance can never show different words.
 */
export default function Terms() {
  const navigate = useNavigate();

  return (
    <AppShell wide>
      <div className="mx-auto max-w-3xl px-4 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="-ml-2 mb-4 text-muted-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>

        <h1 className="font-display text-3xl font-semibold text-foreground">Terms of Use</h1>
        <p className="mt-1 text-sm text-muted-foreground">Effective {TERMS_EFFECTIVE_DATE}</p>

        <div className="mt-6 space-y-6">
          {TERMS_SECTIONS.map((section) => (
            <section key={section.heading}>
              <h2 className="font-display text-lg font-semibold text-foreground">
                {section.heading}
              </h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
