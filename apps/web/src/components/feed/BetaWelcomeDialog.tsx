import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "ayeandnay:seen-beta-welcome";

/**
 * The pre-beta notice. A banner, not a modal — and that change IS the fix.
 *
 * WHAT WAS REPORTED: "the Timeline sidebar item does not navigate." The link
 * was fine. This component was a blocking Dialog whose overlay covered the
 * whole viewport, so the first click anywhere — including on the sidebar —
 * landed on the overlay, closed the dialog, and went no further. From the
 * reader's side: you press Timeline, something flickers, you are still on the
 * Feed. Press it again and it works, but by then it has already read as broken.
 *
 * Proven in a browser rather than reasoned about: Playwright reported
 * `<div class="fixed inset-0 z-50 bg-black/80"> intercepts pointer events`
 * on the sidebar link, and every link navigated correctly once the dialog was
 * dismissed.
 *
 * A pre-beta notice does not need to take the app hostage to be read. As a
 * banner it says the same thing, stays until dismissed, and never eats a click
 * meant for something else.
 *
 * The name was wrong too: "AyeAndNay" is not the platform's name.
 */
export function BetaWelcomeDialog() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch {
      // Private mode, or storage disabled. Showing it every visit is a worse
      // failure than not showing it at all.
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Same. The banner still closes for this session.
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/10 p-4"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-orange-600">
        <Sparkles className="h-4.5 w-4.5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-foreground">Welcome to AYE &amp; NAY</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          We&rsquo;re still in pre-beta and launching for your feedback. Together, we can reclaim
          democracy.
        </p>
        <Button size="sm" onClick={dismiss} className="mt-3">
          Got it
        </Button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss the pre-beta notice"
        className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
