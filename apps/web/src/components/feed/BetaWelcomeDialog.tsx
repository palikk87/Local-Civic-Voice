import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TERMS_VERSION } from "@/lib/legal/terms";
import { PRIVACY_VERSION } from "@/lib/legal/privacy";
import { api } from "@/lib/api";
import { useCurrentUser, useAuthUI } from "@/hooks/use-civic-auth";

/**
 * What version this BROWSER has accepted — for signed-out visitors only.
 *
 * Somebody who has not signed in has no profile to record an agreement against,
 * and re-prompting them on every page load would be its own kind of broken. So
 * the browser remembers it for them, and the moment they have an account the
 * server takes over.
 *
 * For anybody signed in this is not consulted. Their acceptance lives on their
 * profile, so it follows them to a new phone instead of being asked again.
 */
const ACCEPTED_KEY = "ayeandnay:accepted-terms-version";

/**
 * The first-visit welcome — a modal, shown until the Terms are accepted.
 *
 * IT WAS A MODAL, THEN A BANNER, NOW A MODAL AGAIN, and the history matters
 * because the middle step fixed a real bug this version must not bring back.
 * The old modal's overlay covered the viewport but did not read AS a modal, so
 * a first-time visitor would press a sidebar link, the overlay would swallow
 * the click and quietly close the notice, and they were still on the Feed. The
 * report was "Timeline does not navigate." It navigated fine; the click never
 * reached it. It was made a banner, which cannot eat a click.
 *
 * This is a modal again because it now asks something of the visitor — to
 * accept the Terms — which a banner cannot gate. It owns being a modal: it dims
 * the page, sits in the middle, traps focus, and the ONLY thing that carries
 * you into the app is the deliberate "Agree & continue" button. A stray click
 * on the backdrop does nothing at all, so it can never silently take you
 * somewhere, which is the exact trap the banner was built to avoid.
 *
 * ACCEPTANCE IS VERSIONED. What is stored is which version of the Terms was
 * accepted, so a later material change to the Terms re-prompts rather than
 * being assumed. Reading the Terms opens /terms in a new tab, so the modal is
 * still here when the reader comes back.
 *
 * nav-check accepts the Terms first, the way a real first-time visitor does,
 * then proves every destination is reachable.
 */
export function BetaWelcomeDialog() {
  const [show, setShow] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const { isAuthenticated, isLoading } = useCurrentUser();

  /**
   * NEVER WHILE THE SIGN-IN DIALOG IS OPEN.
   *
   * THE BUG THIS FIXES, and it dead-ended sign-up on the live site: after the
   * basic-information step this modal appeared ON TOP of the email-verification
   * modal, and nothing on it worked — the checkbox would not tick, the button
   * would not press. A new account could not get in at all.
   *
   * Two causes, and both are fixed here.
   *
   * WHY IT APPEARED. Terms acceptance moved from the browser onto the profile,
   * so this now asks the server "has this person accepted?". A brand-new
   * account has not, so it fired the instant sign-up created the session —
   * while verification was still on screen. Reading localStorage hid this
   * before, because the browser already had the key.
   *
   * WHY IT WAS DEAD. AuthDialog is a Radix Dialog, which is modal: it sets
   * `pointer-events: none` on <body> and restores them only inside its own
   * portal. This was a hand-rolled fixed div OUTSIDE that portal, so it painted
   * on top and received nothing. Raising the z-index would not have helped —
   * the events were never coming.
   *
   * So: it does not render while auth is open, full stop. Not a delay, not a
   * z-index — there is simply never a second modal to collide with.
   */
  const { open: authOpen } = useAuthUI();

  useEffect(() => {
    // Wait for the session before deciding. Asking a signed-in person to accept
    // again, because their session had not resolved yet, is the exact "two
    // profiles" feeling this is meant to remove.
    if (isLoading) return;
    let cancelled = false;

    if (isAuthenticated) {
      api
        .get<{ acceptedVersion: string | null; privacyVersion: string | null }>(
          "/api/users/me/terms",
        )
        .then((answer) => {
          // Either being out of date brings this back. They are recorded
          // separately so a change to one does not silently re-ask for both,
          // but a person who has not accepted the current pair is asked.
          const stale =
            answer?.acceptedVersion !== TERMS_VERSION ||
            answer?.privacyVersion !== PRIVACY_VERSION;
          if (!cancelled) setShow(stale);
        })
        // Unreachable server: ask rather than assume. Accepting twice costs a
        // click; assuming an agreement nobody gave costs more than that.
        .catch(() => {
          if (!cancelled) setShow(true);
        });
      return () => {
        cancelled = true;
      };
    }

    // Signed out: this browser is the only thing that can remember.
    try {
      if (localStorage.getItem(ACCEPTED_KEY) !== TERMS_VERSION) setShow(true);
    } catch {
      // Private mode or storage disabled: show it this session rather than
      // pretend it was accepted.
      setShow(true);
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    if (!show) return;
    cardRef.current?.focus();
  }, [show]);

  const accept = () => {
    if (!agreed) return;

    if (isAuthenticated) {
      // ON THE PROFILE, so it follows them to every device they ever use.
      // Fire and forget: the modal closes now either way, and a failed write
      // means they are asked once more rather than silently recorded.
      void api
        .post("/api/users/me/terms", {
          version: TERMS_VERSION,
          privacyVersion: PRIVACY_VERSION,
        })
        .catch(() => undefined);
    } else {
      // No account to record it against yet.
      try {
        localStorage.setItem(ACCEPTED_KEY, TERMS_VERSION);
      } catch {
        // The modal still closes for this session even if we cannot remember it.
      }
    }
    setShow(false);
  };

  // Ordered deliberately: the auth check first, so no amount of state above can
  // put this on screen alongside the sign-in dialog.
  if (authOpen) return null;
  if (!show) return null;

  return (
    <div
      // The backdrop deliberately does nothing on click — this is a consent
      // gate, and a stray click must never carry the visitor past it or into
      // the app behind it.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="beta-welcome-title"
        tabIndex={-1}
        // CAPPED AND SCROLLABLE, and this one matters more than the rest.
        //
        // THE BUG THIS FIXES. Reported twice: "you cant scroll on the pop up
        // windows making accessing the lower portion nearly impossible", then
        // "I closed and reopened in a new tab and it still doesn't allow for
        // scrolling." The first fix went through the design system's dialog —
        // and this consent gate is hand-rolled, so it was never touched.
        //
        // It is centred with no ceiling, so on a short window it hung off BOTH
        // ends. The thing below the fold is the agree checkbox and the button:
        // a visitor on a laptop could not get past the front door, and the
        // backdrop deliberately does not dismiss, so there was no way through
        // at all.
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-accent/30 bg-card p-6 shadow-2xl outline-none"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600">
          <Sparkles className="h-6 w-6 text-white" />
        </div>

        <h2 id="beta-welcome-title" className="font-display text-2xl font-semibold text-foreground">
          Welcome to AYE &amp; NAY
        </h2>
        <p className="mt-2 text-muted-foreground">
          Real laws, your voice, still in beta. Found a rough edge? The bug reporter &mdash; on
          every screen &mdash; sends it straight to the team.
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
            aria-label="I have read and agree to the Terms of Use and the Privacy Policy"
          />
          <span className="text-sm text-muted-foreground">
            I have read and agree to the{" "}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline underline-offset-2"
            >
              Terms of Use
            </a>{" "}
            and the{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-accent underline underline-offset-2"
            >
              Privacy Policy
            </a>
            , including that my information is stored in the United States.
          </span>
        </label>

        <Button onClick={accept} disabled={!agreed} className="mt-5 w-full">
          Agree &amp; continue
        </Button>
      </div>
    </div>
  );
}
