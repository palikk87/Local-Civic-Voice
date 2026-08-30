import { useEffect, useState } from "react";

/**
 * Let a page ask for its data in the order a reader meets it.
 *
 * THE PROBLEM. Opening a law fires ten requests at once — the record, the vote
 * tally, the conversation, the representation gap, the pulse history, the
 * turning points, the other side, the integrity audit, the session, the
 * notifications. Five of those paint panels 1,500px down the page that most
 * readers never scroll to, and the browser opens them all before it has
 * finished painting the top of the screen. The thing somebody came for waits
 * behind the things they have not looked at.
 *
 * WHAT THIS IS NOT. It is not lazy loading and nothing is dropped. Every one of
 * the ten still runs, unconditionally, on every visit — asked for in order
 * rather than all at once. A reader who never scrolls still causes exactly the
 * same requests they always did.
 *
 * That was the instruction, and it was the right call: "keep all the requests
 * but prioritize the requests from top to bottom of the page." Deferring to a
 * scroll would have been the smaller number of requests and the worse product —
 * a panel that has not started loading when you reach it is a spinner you have
 * to wait at, and on a fast connection the ordering alone is enough.
 *
 * HOW. Stages open one after another on the next frame. Stage 0 is open from
 * the first render; each later stage opens once the browser has been given a
 * chance to paint what the previous one asked for. That is deliberately time
 * ordering rather than dependency ordering: these panels do not depend on each
 * other's data, they only compete for the same connections, so what matters is
 * who gets to ask first.
 *
 * Frames rather than a timer, so it costs nothing on a fast machine and does
 * not sit on an arbitrary delay on a slow one. A background tab does not paint,
 * so a rAF chain would stall there — the timeout is the floor that keeps it
 * moving either way.
 *
 * @param stages how many stages this page has, counting stage 0.
 * @returns `openThrough`, the highest stage currently allowed to fetch.
 */
export function useLoadOrder(stages: number): number {
  const [openThrough, setOpenThrough] = useState(0);

  useEffect(() => {
    if (openThrough >= stages - 1) return;

    let frame = 0;
    const advance = () => setOpenThrough((current) => Math.min(current + 1, stages - 1));

    // Two frames: one for the browser to start the current stage's requests,
    // one for it to paint. Then open the next.
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(advance);
    });
    const floor = setTimeout(advance, 250);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(floor);
    };
  }, [openThrough, stages]);

  return openThrough;
}
