/**
 * The Citizen's Brief, on request.
 *
 * WHAT CHANGED AND WHY. Opening a law used to start writing its brief by
 * itself, and the screen polled a server status until it said otherwise. Two
 * things were wrong with that. A reader who only wanted to read the law paid
 * for a model call they never asked for; and when the work behind the status
 * died — a restart, a deploy, a crashed job — the status stayed "working"
 * forever, so the spinner never stopped and reloading did not help, because the
 * stuck state was in the database rather than the browser.
 *
 * Now it is a button. Nothing happens until someone presses it. The request
 * itself is the wait, and it comes back with one of three answers: the brief,
 * "still writing, ask again", or "no official source has the text". Each is a
 * place the reader can stand — none of them is a spinner with no end.
 *
 * The one place polling survives is `working`, and it is bounded: the server
 * only reports it while work is genuinely in flight, and abandoned work is
 * reported as idle, which puts the button back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  referenceKeys,
  requestCitizenBrief,
  type BriefResponse,
  type CitizenBriefSections,
} from "@/lib/api/references";

/** How long between asks while the server says it is still writing. */
const POLL_MS = 4000;

/**
 * Give up asking after this long and offer the button again.
 *
 * A generous ceiling, not a timeout on the work: the server keeps going and
 * whoever asks next gets the finished brief. This only bounds how long one
 * screen sits watching, so a reader is never trapped the way they used to be.
 */
const POLL_CEILING_MS = 3 * 60 * 1000;

export type BriefUiState = "idle" | "working" | "ready" | "unavailable";

export interface CitizenBrief {
  state: BriefUiState;
  brief: CitizenBriefSections | null;
  /** Why there is no brief, in the server's words. Only set when unavailable. */
  reason: string | null;
  /** True while a request is in the air, so the button can say so. */
  isRequesting: boolean;
  /** Press me. */
  request: () => void;
  /** Rewrite a brief that is already stored. */
  rewrite: () => void;
}

export interface UseCitizenBriefOptions {
  /** A brief already on the reference, so a stored one shows without a request. */
  initialBrief?: CitizenBriefSections | null;
  /** The server's collapsed state for this reference, from the detail response. */
  initialState?: BriefUiState;
}

export function useCitizenBrief(
  referenceId: string | null | undefined,
  options: UseCitizenBriefOptions = {},
): CitizenBrief {
  const { initialBrief = null, initialState } = options;
  const queryClient = useQueryClient();

  const [brief, setBrief] = useState<CitizenBriefSections | null>(initialBrief);
  const [state, setState] = useState<BriefUiState>(initialState ?? (initialBrief ? "ready" : "idle"));
  const [reason, setReason] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);

  // Polling lives in a ref so a re-render never leaves a second timer running,
  // and so unmounting genuinely stops it.
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopAt = useRef<number>(0);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => clearPoll, [clearPoll]);

  // A different reference means a different brief. Without this the previous
  // law's brief stays on screen under the new law's title.
  useEffect(() => {
    clearPoll();
    setBrief(initialBrief);
    setState(initialState ?? (initialBrief ? "ready" : "idle"));
    setReason(null);
    setIsRequesting(false);
  }, [referenceId, initialBrief, initialState, clearPoll]);

  const apply = useCallback(
    (response: BriefResponse, id: string) => {
      if (response.state === "ready") {
        clearPoll();
        setBrief(response.brief);
        setState("ready");
        setReason(null);
        // The detail response carries the brief too, so anything else on the
        // page reading it sees the same thing without a second round trip.
        void queryClient.invalidateQueries({ queryKey: referenceKeys.detail(id) });
        return;
      }

      if (response.state === "unavailable") {
        clearPoll();
        setState("unavailable");
        setReason(response.reason);
        return;
      }

      setState("working");
    },
    [clearPoll, queryClient],
  );

  const ask = useCallback(
    async (id: string, force: boolean) => {
      setIsRequesting(true);
      try {
        const response = await requestCitizenBrief(id, force);
        apply(response, id);
        return response.state;
      } catch {
        clearPoll();
        setState("unavailable");
        setReason("The brief couldn't be written just now. Try again in a moment.");
        return "unavailable" as const;
      } finally {
        setIsRequesting(false);
      }
    },
    [apply, clearPoll],
  );

  // Keep asking while the server says it is still writing, and stop at the
  // ceiling rather than forever.
  const schedulePoll = useCallback(
    (id: string) => {
      clearPoll();
      pollTimer.current = setTimeout(() => {
        if (Date.now() > stopAt.current) {
          // Out of patience, not out of hope: the work continues server-side.
          // Offering the button back is the honest thing to show.
          setState("idle");
          return;
        }
        void ask(id, false).then((next) => {
          if (next === "working") schedulePoll(id);
        });
      }, POLL_MS);
    },
    [ask, clearPoll],
  );

  const start = useCallback(
    (force: boolean) => {
      if (!referenceId) return;
      stopAt.current = Date.now() + POLL_CEILING_MS;
      setState("working");
      setReason(null);
      void ask(referenceId, force).then((next) => {
        if (next === "working") schedulePoll(referenceId);
      });
    },
    [ask, referenceId, schedulePoll],
  );

  return {
    state,
    brief,
    reason,
    isRequesting,
    request: useCallback(() => start(false), [start]),
    rewrite: useCallback(() => start(true), [start]),
  };
}
