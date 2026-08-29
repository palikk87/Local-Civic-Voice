import * as React from "react";

/**
 * Is the three-column law page actually three columns?
 *
 * WHY 1280 AND NOT THE 768 IN use-mobile. This is not a question about phones.
 * It is the exact breakpoint at which ReferenceDetail's grid stops stacking and
 * puts the vote panel in a column beside the article — Tailwind's `xl`. Asking
 * `useIsMobile` here would answer a different question and be wrong for every
 * tablet between the two.
 *
 * THE INITIAL VALUE IS READ SYNCHRONOUSLY, not left undefined until an effect
 * runs. A hook that reports "narrow" on the first paint and corrects itself a
 * frame later moves the vote buttons under the reader's thumb, which is the
 * class of bug this file was written during.
 */
const WIDE = "(min-width: 1280px)";

export function useIsWide(): boolean {
  const [isWide, setIsWide] = React.useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(WIDE).matches,
  );

  React.useEffect(() => {
    const query = window.matchMedia(WIDE);
    const onChange = (event: MediaQueryListEvent) => setIsWide(event.matches);
    query.addEventListener("change", onChange);
    // Re-read on mount in case the window changed between render and effect.
    setIsWide(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isWide;
}
