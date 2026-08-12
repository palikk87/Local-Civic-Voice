import { Link } from "react-router-dom";
import { MessageSquare, ArrowUpRight } from "lucide-react";
import { MotionDiv } from "@/components/civic/Motion";
import { Card } from "@/components/ui/card";
import { PublicPulseBar } from "@/components/civic/PublicPulseBar";
import { ReferenceTypeBadge, CategoryBadge, StatusBadge } from "@/components/civic/badges";
import type { GovReference } from "@/lib/civic";

interface ReferenceCardProps {
  reference: GovReference;
  index?: number;
}

export function ReferenceCard({ reference, index = 0 }: ReferenceCardProps) {
  return (
    <MotionDiv
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.3) }}
    >
      <Link to={`/reference/${reference.id}`} className="group block h-full">
        <Card className="flex h-full flex-col gap-4 border-border/80 p-5 shadow-sm transition-all duration-300 group-hover:-translate-y-1 group-hover:border-accent/50 group-hover:shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <ReferenceTypeBadge type={reference.referenceType} />
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold leading-snug text-foreground text-balance">
              {reference.shortTitle || reference.title}
            </h3>
            {reference.shortTitle ? (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {reference.title}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={reference.category} />
            <StatusBadge status={reference.status} />
          </div>

          <div className="mt-auto space-y-2 border-t border-border/60 pt-4">
            <PublicPulseBar votes={reference.votes} size="sm" />
            <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
              <span>{reference.votes.total.toLocaleString()} votes cast</span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {reference.engagement.comments}
              </span>
            </div>
          </div>
        </Card>
      </Link>
    </MotionDiv>
  );
}
