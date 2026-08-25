import { useCallback, useEffect, useState } from "react";
import { Bug, Crosshair, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

/**
 * Report a bug by pointing at it.
 *
 * WHY POINTING RATHER THAN TYPING. The hardest part of a bug report is saying
 * where you were and what you touched, and it is the part the app already
 * knows. Asking somebody to describe "the second button under the vote bar on
 * the bill page" is asking them to do work the browser can do exactly.
 *
 * WHAT IT CAPTURES: the visible label of what you clicked, a DOM path for
 * whoever has to find it, the URL, the viewport, the browser, and the commit
 * being served. That last one matters more than it looks — half of "I cannot
 * reproduce it" is the reporter being on a build that no longer exists.
 *
 * TWO QUESTIONS, NOT ONE. What happened, and what you wanted instead. The
 * second is optional and is the one that turns a complaint into a change.
 *
 * SIGNED OUT CAN REPORT. The people most likely to hit a blocking bug are the
 * ones who could not get past sign-up, and they are exactly who a gate would
 * silence.
 */

type Stage = "idle" | "picking" | "writing" | "sending";

interface Picked {
  label: string;
  path: string;
}

/** A short, human description of an element — what a person would call it. */
function describe(element: Element): string {
  const aria = element.getAttribute("aria-label");
  if (aria) return aria.slice(0, 120);

  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text && text.length <= 80) return text;
  if (text) return `${text.slice(0, 77)}…`;

  const alt = element.getAttribute("alt") ?? element.getAttribute("title");
  if (alt) return alt.slice(0, 120);

  return element.tagName.toLowerCase();
}

/** Enough of a path for somebody to find it in the source. */
function domPath(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  for (let depth = 0; node && depth < 5; depth += 1) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      part += `#${node.id}`;
    } else {
      // First two classes only. Tailwind puts thirty on everything, and the
      // whole list is noise in a report somebody has to read.
      const cls = (node.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += `.${cls.join(".")}`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(" > ").slice(0, 500);
}

export function BugReporter() {
  const [stage, setStage] = useState<Stage>("idle");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState("");
  const [wanted, setWanted] = useState("");

  const stopPicking = useCallback(() => {
    document.body.style.cursor = "";
    setStage("writing");
  }, []);

  // While picking, the next click anywhere is the answer rather than the
  // action. Captured on the way down and stopped, so pointing at a Delete
  // button does not delete anything.
  useEffect(() => {
    if (stage !== "picking") return undefined;

    document.body.style.cursor = "crosshair";

    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || target.closest("[data-bug-reporter]")) return;

      event.preventDefault();
      event.stopPropagation();
      setPicked({ label: describe(target), path: domPath(target) });
      stopPicking();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopPicking();
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.cursor = "";
    };
  }, [stage, stopPicking]);

  function reset() {
    setStage("idle");
    setPicked(null);
    setProblem("");
    setWanted("");
  }

  async function send() {
    if (problem.trim().length < 3) {
      toast.error("Say what went wrong, even briefly.");
      return;
    }

    setStage("sending");
    try {
      await api.post("/api/bug-reports", {
        pageUrl: window.location.href,
        pagePath: window.location.pathname,
        elementLabel: picked?.label,
        elementPath: picked?.path,
        problem: problem.trim(),
        wanted: wanted.trim() || undefined,
        userAgent: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        appCommit: (import.meta.env.VITE_COMMIT_SHA as string | undefined) ?? undefined,
      });
      toast.success("Sent", { description: "Thank you — an admin will see this." });
      reset();
    } catch (error) {
      setStage("writing");
      toast.error(error instanceof Error ? error.message : "Could not send that report.");
    }
  }

  if (stage === "idle") {
    return (
      <button
        type="button"
        data-bug-reporter
        onClick={() => setStage("writing")}
        aria-label="Report a problem with this page"
        className="fixed bottom-20 right-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground lg:bottom-6"
      >
        <Bug className="h-5 w-5" />
      </button>
    );
  }

  if (stage === "picking") {
    return (
      <div
        data-bug-reporter
        className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2.5 text-sm font-medium text-amber-950"
      >
        <Crosshair className="h-4 w-4" />
        Click the thing that is giving you trouble.
        <button type="button" onClick={stopPicking} className="underline">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div
      data-bug-reporter
      className="fixed bottom-20 right-4 z-50 w-[min(92vw,22rem)] rounded-xl border border-border bg-card p-4 shadow-2xl lg:bottom-6"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bug className="h-4 w-4 text-amber-500" />
          <span className="font-semibold text-foreground">Report a problem</span>
        </div>
        <button type="button" onClick={reset} aria-label="Close">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {picked ? (
        <div className="mb-3 rounded-md border border-border bg-muted/40 p-2 text-xs">
          <span className="text-muted-foreground">You pointed at </span>
          <span className="font-medium text-foreground">“{picked.label}”</span>
          <button
            type="button"
            onClick={() => setPicked(null)}
            className="ml-2 text-muted-foreground underline"
          >
            clear
          </button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="mb-3 w-full"
          onClick={() => setStage("picking")}
        >
          <Crosshair className="mr-2 h-4 w-4" />
          Point at the problem
        </Button>
      )}

      <label className="text-xs font-medium text-foreground" htmlFor="bug-problem">
        What happened?
      </label>
      <Textarea
        id="bug-problem"
        rows={3}
        value={problem}
        onChange={(event) => setProblem(event.target.value)}
        placeholder="I pressed Vote Nay and the bar stayed grey."
        className="mb-3 mt-1"
      />

      <label className="text-xs font-medium text-foreground" htmlFor="bug-wanted">
        What should it have done? <span className="text-muted-foreground">(optional)</span>
      </label>
      <Textarea
        id="bug-wanted"
        rows={2}
        value={wanted}
        onChange={(event) => setWanted(event.target.value)}
        placeholder="Filled the bar red and counted my vote."
        className="mb-3 mt-1"
      />

      <Button className="w-full" disabled={stage === "sending"} onClick={() => void send()}>
        {stage === "sending" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {stage === "sending" ? "Sending…" : "Send to the team"}
      </Button>

      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Sends the page you are on, what you pointed at, your browser size and the app
        version. Nothing else.
      </p>
    </div>
  );
}
