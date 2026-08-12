// Web port of SectionHeader in webapp/mobile/src/app/(tabs)/people.tsx
import type { ReactNode } from "react";

interface SectionHeaderProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
}

export function SectionHeader({ icon, title, subtitle }: SectionHeaderProps) {
  return (
    <div className="mb-4 mt-6 flex items-center">
      <span className="mr-3 rounded-full bg-muted p-2">{icon}</span>
      <div>
        <p className="text-lg font-bold text-foreground">{title}</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}
