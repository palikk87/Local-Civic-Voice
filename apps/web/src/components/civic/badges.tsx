import { Landmark, PenLine, Gavel } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReferenceType } from "@/lib/civic";
import { REFERENCE_TYPE_LABEL, titleCase } from "@/lib/civic";

const TYPE_META: Record<
  ReferenceType,
  { icon: typeof Landmark; className: string }
> = {
  bill: { icon: Landmark, className: "border-legislative/40 text-legislative bg-legislative/10" },
  executive_order: { icon: PenLine, className: "border-executive/40 text-executive bg-executive/10" },
  scotus_case: { icon: Gavel, className: "border-judicial/40 text-judicial bg-judicial/10" },
};

export function ReferenceTypeBadge({
  type,
  className,
}: {
  type: ReferenceType;
  className?: string;
}) {
  const meta = TYPE_META[type];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
        meta.className,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {REFERENCE_TYPE_LABEL[type]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: string | null | undefined }) {
  const label = titleCase(category);
  // Not every reference in the record has a category — skip the tag rather than
  // rendering an empty pill.
  if (!label) return null;
  return (
    <Badge variant="secondary" className="rounded-full font-medium">
      {label}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const label = titleCase(status);
  if (!label) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {label}
    </span>
  );
}
