/**
 * THE PLATFORM RATING ITS OWN RECORD, IN PUBLIC — and saying why.
 *
 * WHAT THIS REPLACES. A chip scored by arithmetic over constants: 40 points
 * from one hardcoded source, invented weights for the rest, and a ceiling of 80
 * against a top bar of 90 — so its best badge was unreachable for every law on
 * every screen. Every post in the feed read "? Unverified" in red, forever, on
 * records that came straight from congress.gov.
 *
 * THE CHECKLIST IS THE FEATURE, NOT THE CHIP. Khalid: "if they just see
 * unconfirmed for example they are wary but don't understand but if they see it
 * and then see its just bc a brief or what ever else criteria is missing then
 * then they understand it and trust it more." A badge on its own makes somebody
 * uneasy about a law that is perfectly real. The same badge opened up — source
 * linked, text held, checked two days ago, brief not written yet — turns that
 * into understanding. So the chip is a button, and the panel is the point.
 *
 * THE SERVER DECIDES. Every line comes from services/record-completeness.ts, so
 * a feed card and the law's own page can never disagree about our own work.
 * Nothing is computed here.
 */
import { useState } from "react";
import { Shield, Check, Minus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface RecordCompleteness {
  level: "verified" | "confirmed" | "unconfirmed" | "unverified";
  label: string;
  met: number;
  applicable: number;
  checks: Array<{ id: string; label: string; met: boolean; detail: string | null }>;
}

/**
 * The four badges and what each one costs, shown in the panel.
 *
 * Repeated here rather than sent per card: it is the same four lines on every
 * record, and a reader opening the panel wants to know where this one sits
 * among them. The server owns which level applies; this only explains them.
 */
const LADDER: Array<{ level: RecordCompleteness["level"]; label: string; requirement: string }> = [
  { level: "verified", label: "Verified", requirement: "Everything we should hold, we hold" },
  { level: "confirmed", label: "Confirmed", requirement: "One thing still outstanding" },
  { level: "unconfirmed", label: "Unconfirmed", requirement: "Two things still outstanding" },
  { level: "unverified", label: "Unverified", requirement: "Three or more, including part of the sourcing" },
];

/** Colour per level. Never colour alone — the icon and the word carry it too. */
const TONE: Record<RecordCompleteness["level"], { color: string; icon: string }> = {
  verified: { color: "#22C55E", icon: "✓✓" },
  confirmed: { color: "#3B82F6", icon: "✓" },
  unconfirmed: { color: "#F59E0B", icon: "~" },
  unverified: { color: "#EF4444", icon: "?" },
};

export function RecordBadge({
  completeness,
  title,
}: {
  completeness: RecordCompleteness | null | undefined;
  /** The law, so the panel says which record it is rating. */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  // An older server sends nothing. No chip is better than a made-up one.
  if (!completeness) return null;

  const tone = TONE[completeness.level];
  const outstanding = completeness.checks.filter((check) => !check.met);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          // The whole card is a link to the law. This opens the panel instead.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className="flex shrink-0 items-center rounded-full px-2 py-0.5"
        style={{ backgroundColor: `${tone.color}20` }}
        aria-label={`Our record: ${completeness.label}. ${completeness.met} of ${completeness.applicable} checks. Open the checklist.`}
      >
        <Shield size={10} color={tone.color} />
        <span className="ml-1 text-xs font-medium" style={{ color: tone.color }}>
          {tone.icon} {completeness.label}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Our record of this law</DialogTitle>
            <DialogDescription>
              {/*
                Said plainly, because the badge grades US and not the law. Every
                record on this platform comes from congress.gov, the Federal
                Register or CourtListener; what varies is how much of it we have
                finished pulling together.
              */}
              This rates how complete our own record is — not whether the law is
              real. {title ? `For ${title}, we` : "We"} hold {completeness.met} of{" "}
              {completeness.applicable}.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2.5">
            {completeness.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2.5">
                {check.met ? (
                  <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <Minus size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      check.met ? "text-sm text-foreground" : "text-sm text-muted-foreground"
                    }
                  >
                    {check.label}
                  </span>
                  {/* The real value behind the tick, which is what makes the
                      badge believable rather than another opaque score. */}
                  {check.detail ? (
                    <span className="block text-xs text-muted-foreground">{check.detail}</span>
                  ) : null}
                </span>
                <span className="sr-only">{check.met ? "held" : "outstanding"}</span>
              </li>
            ))}
          </ul>

          {outstanding.length > 0 ? (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {/*
                Named rather than left to inference. A Citizen's Brief is only
                ever written because a reader asked for one — nothing writes them
                in the background — so this line is also how somebody learns they
                can move the badge themselves.
              */}
              Outstanding: {outstanding.map((check) => check.label.toLowerCase()).join(", ")}. A
              Citizen's Brief is written when somebody asks for one, and this updates when it is.
            </p>
          ) : null}

          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs font-medium text-foreground">What the badges mean</p>
            <ul className="space-y-1.5">
              {LADDER.map((rung) => (
                <li key={rung.level} className="flex items-baseline gap-2 text-xs">
                  <span
                    className="w-24 shrink-0 font-medium"
                    style={{ color: TONE[rung.level].color }}
                  >
                    {TONE[rung.level].icon} {rung.label}
                  </span>
                  <span className="text-muted-foreground">{rung.requirement}</span>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
