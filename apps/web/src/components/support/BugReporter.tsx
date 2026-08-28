import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 *
 * AND IT WORKS WHILE A DIALOG IS OPEN, which it did not.
 *
 * Reported as "the bug reporter doesnt work with these screens", after two
 * reports about dialogs that could only point at the BUTTON that opened them.
 * That was not a coincidence: a modal dialog sets `pointer-events: none` on the
 * body, so this button inherited it, sat at the same z-index as the overlay
 * that now painted over it, and was inside an aria-hidden subtree. Measured in
 * a browser with a dialog open: elementFromPoint over the launcher returned the
 * overlay, and clicking it timed out.
 *
 * The one part of the app whose whole job is reporting the others cannot be the
 * part that stops working when something is wrong. So it renders in its own
 * portal, above everything, takes its own pointer events back, keeps itself
 * announced, and — the part that matters most — swallows its own pointer-downs
 * so that clicking it does not dismiss the dialog you are trying to report.
 */

type Stage = "idle" | "picking" | "writing" | "sending";

interface Picked {
  label: string;
  path: string;
  detail: ElementDetail;
}

/**
 * What was actually pointed at, as opposed to what it said.
 *
 * THE FLAW THIS FIXES. A report used to carry the visible words and a path
 * made of tag names and the first two Tailwind classes — "div.flex.items-center
 * > button.w-full.text-left". To the person reporting, "the Nay button" is the
 * right thing to see. To the admin who has to fix it, the word is the one
 * piece of information they already had: it is in the complaint. What they
 * could not get was WHICH Nay button, on which record, rendered by what.
 *
 * Everything below is read off the element itself. Nothing is inferred and
 * nothing is guessed — where the page does not say, the field is absent rather
 * than filled with something plausible.
 */
interface ElementDetail {
  /** A selector that finds this exact element again, not a family of them. */
  selector: string;
  tag: string;
  /** The React component that rendered it. Absent if the fiber is unreadable. */
  component?: string;
  /** The clickable thing the click really belonged to, when it was not the target. */
  control?: string;
  /** Where a link or form actually goes. */
  action?: string;
  /** The identifying attributes on the element. Never a field's value. */
  attributes?: Record<string, string>;
  /**
   * The app's own markers, from the element and its ancestors.
   *
   * This is where the RECORD lives: data-reference-id, data-post-id and the
   * like say which bill or which post the thing was showing, which is the
   * question "what were you pointing at" actually means.
   */
  data?: Record<string, string>;
  /** The markup, with anything typed into a field removed. */
  html?: string;
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

/** A short, readable name for an element, for the `control` line. */
function shortName(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const label = element.getAttribute("aria-label") ?? describe(element);
  return label && label !== tag ? `${tag} "${label.slice(0, 60)}"` : tag;
}

/**
 * A selector that re-finds this element and only this element.
 *
 * Stops early at an id or a test id, because those are stable and everything
 * above them is noise. Falls back to :nth-of-type, which survives the Tailwind
 * class churn that made the old path useless.
 */
function uniqueSelector(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;

  for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
    const testId = node.getAttribute("data-testid");
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    if (testId) {
      parts.unshift(`[data-testid="${CSS.escape(testId)}"]`);
      break;
    }

    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((c) => c.tagName === node!.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
    } else {
      parts.unshift(tag);
    }
    node = parent;
  }

  return parts.join(" > ").slice(0, 500);
}

/**
 * The React component that rendered this node.
 *
 * Walks up the fiber past the host elements (div, button — lowercase) to the
 * first named component. Vite is configured with keepNames so this survives
 * minification; without it every answer here would be a minified shard, which
 * is worse than no answer because it looks like one.
 */
function reactComponent(element: Element): string | undefined {
  const key = Object.keys(element).find(
    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
  );
  if (!key) return undefined;

  let fiber = (element as unknown as Record<string, unknown>)[key] as
    | { elementType?: unknown; type?: unknown; return?: unknown }
    | undefined;

  const seen: string[] = [];
  for (let depth = 0; fiber && depth < 40; depth += 1) {
    const type = (fiber.elementType ?? fiber.type) as
      | { displayName?: string; name?: string }
      | string
      | undefined;
    if (type && typeof type !== "string") {
      const name = type.displayName ?? type.name;
      // Lowercase means a host element; anonymous and internal wrappers are
      // not worth reporting either.
      if (name && /^[A-Z]/.test(name) && !seen.includes(name) && !isScaffolding(name)) {
        seen.push(name);
        if (seen.length === 4) break;
      }
    }
    fiber = fiber.return as typeof fiber;
  }

  // The innermost first, then what it sits inside — "VoteButtons in BillCard"
  // locates a thing far better than either name alone.
  return seen.length ? seen.join(" in ") : undefined;
}

/**
 * Wrappers that are true of everything and therefore say nothing.
 *
 * The first run of this reported "AppShell in RenderedRoute in Routes". The
 * first name locates the thing; the other two are react-router internals that
 * would appear on every report ever filed. Noise that looks like information is
 * worse than a shorter answer.
 */
const FRAMEWORK = new Set([
  "Routes",
  "Route",
  "RenderedRoute",
  "Router",
  "BrowserRouter",
  "Outlet",
  "Suspense",
  "SuspenseList",
  "Fragment",
  "StrictMode",
  "Profiler",
  "Slot",
  "Primitive",
  "Presence",
]);

/**
 * A RULE RATHER THAN A LONGER LIST.
 *
 * The list above caught the router; the next run reported "AppShell in
 * AuthUIProvider in TooltipProviderProvider". Providers wrap the whole tree by
 * definition, so every one of them is true of every report — and a denylist of
 * them is a thing somebody has to remember to extend every time a library is
 * added. The suffix is what makes them uninformative, so the suffix is what is
 * matched.
 */
function isScaffolding(name: string): boolean {
  return FRAMEWORK.has(name) || /(Provider|Context|Boundary|Portal|Root)$/.test(name);
}

/** Identity attributes. Deliberately never `value` — that is what a person typed. */
const REPORTED_ATTRIBUTES = [
  "id",
  "name",
  "type",
  "role",
  "href",
  "src",
  "alt",
  "title",
  "placeholder",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-disabled",
  "aria-expanded",
  "aria-selected",
  "aria-current",
  "disabled",
  "data-state",
];

/**
 * The markup, with anything anybody typed taken out.
 *
 * A report is sent to an administrator, and the element somebody points at may
 * be the field they were filling in. The attribute names and structure are the
 * useful part; the contents of an input never are.
 */
function redactedHtml(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const field of [copy, ...copy.querySelectorAll("input, textarea, select")]) {
    if (!(field instanceof Element)) continue;
    if (!/^(input|textarea|select)$/i.test(field.tagName)) continue;
    if (field.hasAttribute("value")) field.setAttribute("value", "[removed]");
    if (field.textContent) field.textContent = "[removed]";
  }
  return copy.outerHTML.replace(/\s+/g, " ").slice(0, 800);
}

/** Everything the element and its ancestors say about what they are. */
function detailFor(element: Element): ElementDetail {
  const attributes: Record<string, string> = {};
  for (const name of REPORTED_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value !== null && value !== "") attributes[name] = value.slice(0, 200);
  }

  // Data attributes from the element upwards. Nearest wins, so a card's id does
  // not overwrite the button's own.
  const data: Record<string, string> = {};
  let node: Element | null = element;
  for (let depth = 0; node && depth < 8; depth += 1) {
    for (const attr of Array.from(node.attributes)) {
      if (!attr.name.startsWith("data-")) continue;
      if (attr.name === "data-bug-reporter") continue;
      if (data[attr.name] === undefined && attr.value) {
        data[attr.name] = attr.value.slice(0, 200);
      }
    }
    node = node.parentElement;
  }

  // People click the text inside a button, not the button.
  const control = element.closest("button, a, input, select, textarea, [role='button'], [role='tab'], [role='link']");
  const action =
    control instanceof HTMLAnchorElement
      ? control.getAttribute("href") ?? undefined
      : control instanceof HTMLFormElement
        ? control.getAttribute("action") ?? undefined
        : (control?.closest("form")?.getAttribute("action") ?? undefined);

  return {
    selector: uniqueSelector(element),
    tag: element.tagName.toLowerCase(),
    component: reactComponent(element),
    control: control && control !== element ? shortName(control) : undefined,
    action: action ?? undefined,
    attributes: Object.keys(attributes).length ? attributes : undefined,
    data: Object.keys(data).length ? data : undefined,
    html: redactedHtml(element),
  };
}

export function BugReporter() {
  const [stage, setStage] = useState<Stage>("idle");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState("");
  const [wanted, setWanted] = useState("");

  /**
   * ITS OWN NODE, DIRECTLY UNDER BODY.
   *
   * Rendered in the tree it sits in, this inherits every stacking context and
   * every `pointer-events: none` its ancestors acquire — and a modal dialog
   * puts exactly that on the body. Its own portal is the only place it is
   * reliably reachable, and the only place a z-index means what it says.
   */
  const host = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = document.createElement("div");
    node.setAttribute("data-bug-reporter-host", "");
    document.body.appendChild(node);
    host.current = node;
    setReady(true);

    /**
     * KEEP IT ANNOUNCED.
     *
     * A modal dialog aria-hides everything outside it, this node included, so
     * a screen-reader user loses the reporter the moment anything opens.
     * aria-hidden cannot be undone from inside — a descendant saying false does
     * not escape an ancestor saying true — so the attribute is taken back off
     * this node whenever it is put on. Deliberate: the way to report a broken
     * dialog must not disappear because a dialog is open.
     */
    const watcher = new MutationObserver(() => {
      if (node.getAttribute("aria-hidden") === "true") node.removeAttribute("aria-hidden");
    });
    watcher.observe(node, { attributes: true, attributeFilter: ["aria-hidden"] });

    return () => {
      watcher.disconnect();
      node.remove();
      host.current = null;
    };
  }, []);

  /**
   * CLICKING THIS MUST NOT CLOSE WHAT YOU ARE REPORTING.
   *
   * A modal dialog dismisses on any pointer-down outside itself. Once this
   * button is reachable again, pressing it counts as outside — so the dialog
   * you opened the reporter to complain about would vanish before you could
   * point at it, which is the same bug wearing a hat.
   *
   * Registered once, at mount, in the capture phase on the document. Radix adds
   * its own document listener when a dialog opens, which is always later, and
   * listeners on the same node in the same phase run in the order they were
   * added — so this one goes first and `stopImmediatePropagation` keeps the
   * dismissal from ever running. Only for events inside the reporter; every
   * other outside click still closes the dialog exactly as before.
   */
  useEffect(() => {
    const swallow = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-bug-reporter],[data-bug-reporter-host]")) {
        event.stopImmediatePropagation();
      }
    };
    const events = ["pointerdown", "mousedown", "touchstart", "focusin"] as const;
    for (const name of events) document.addEventListener(name, swallow, true);
    return () => {
      for (const name of events) document.removeEventListener(name, swallow, true);
    };
  }, []);

  const stopPicking = useCallback(() => {
    document.body.style.cursor = "";
    setStage("writing");
  }, []);

  /**
   * While picking, the next click anywhere is the answer rather than the
   * action — and EVERY PIXEL HAS TO BE POINTABLE.
   *
   * This used to listen for a click on the document. That misses the things
   * people most want to report:
   *
   *   A DISABLED BUTTON DISPATCHES NO CLICK AT ALL. "This button is greyed out
   *   and I do not know why" is one of the commonest reports there is, and it
   *   was the one thing nobody could point at. The same is true of anything
   *   with pointer-events: none.
   *
   *   ANYTHING UNDER A TRANSPARENT LAYER got reported as the layer. The person
   *   pointed at a vote button and the report named the invisible thing on top
   *   of it, which sends whoever reads it looking in the wrong place.
   *
   * So picking puts a sheet over the whole viewport and lets that take the
   * click. Reading the real element is then a hit test at the same point with
   * the sheet made see-through — and elementFromPoint answers with the element
   * that is really there, disabled or not.
   */
  useEffect(() => {
    if (stage !== "picking") return undefined;

    document.body.style.cursor = "crosshair";

    const sheet = document.createElement("div");
    sheet.setAttribute("data-bug-reporter", "picker-sheet");
    // `pointer-events:auto` is not decoration: a modal dialog sets the body to
    // `none`, and this sheet is a child of the body, so without it the sheet
    // received nothing and pointing at anything inside a dialog was impossible.
    sheet.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:transparent;pointer-events:auto";
    document.body.appendChild(sheet);

    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // Look through the sheet to whatever is actually under the pointer.
      sheet.style.pointerEvents = "none";
      const under = document.elementFromPoint(event.clientX, event.clientY);
      sheet.style.pointerEvents = "";

      // Pointing at the reporter's own panel is not a report about anything.
      const target = under?.closest("[data-bug-reporter]") ? null : under;
      if (!target) {
        stopPicking();
        return;
      }

      const detail = detailFor(target);
      setPicked({
        label: describe(target),
        // The old `path` was tag names and two Tailwind classes. The selector
        // is the same idea done properly: it finds the element again.
        path: detail.selector,
        detail,
      });
      stopPicking();
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stopPicking();
    };

    sheet.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      sheet.removeEventListener("click", onClick, true);
      sheet.remove();
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
        // What it actually is, as opposed to what it said.
        elementDetail: picked?.detail,
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

  // Nothing renders until the host node exists; one frame, and it avoids
  // rendering into a portal that is not there yet.
  if (!ready || !host.current) return null;

  /**
   * Above the dialog layer, and taking its own pointer events back.
   *
   * The z-index is deliberately absurd. Dialogs here sit at z-50, and the point
   * of this button is that it works when something is on top of everything
   * else — so it is above the thing that is above everything else.
   */
  const ABOVE_EVERYTHING = "pointer-events-auto z-[2147483000]";

  if (stage === "idle") {
    return createPortal(
      <button
        type="button"
        data-bug-reporter
        onClick={() => setStage("writing")}
        aria-label="Report a problem with this page"
        className={`fixed bottom-20 right-4 ${ABOVE_EVERYTHING} flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground lg:bottom-6`}
      >
        <Bug className="h-5 w-5" />
      </button>,
      host.current,
    );
  }

  if (stage === "picking") {
    return createPortal(
      /*
       * THE BANNER MUST NOT BLOCK POINTING AT WHAT IS UNDER IT.
       *
       * This is a full-width bar across the top of the screen, and the hit test
       * that finds the real element ignores anything with pointer-events: none
       * — so without this, everything beneath the bar was unpointable: the
       * logo, the top of the sidebar, the first row of any page scrolled to the
       * top. Somebody trying to report the thing at the top of their screen got
       * a report with nothing attached to it.
       *
       * Cancel takes its own events back, because it is the one thing here that
       * still has to be clickable.
       */
      <div
        data-bug-reporter
        className="pointer-events-none fixed inset-x-0 top-0 z-[2147483647] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2.5 text-sm font-medium text-amber-950"
      >
        <Crosshair className="h-4 w-4" />
        Click the thing that is giving you trouble.
        <button
          type="button"
          onClick={stopPicking}
          className="pointer-events-auto underline"
        >
          Cancel
        </button>
      </div>,
      host.current,
    );
  }

  return createPortal(
    <div
      data-bug-reporter
      // A short screen is exactly where this gets used, so it caps its own
      // height and scrolls rather than running off the bottom — the bug it
      // exists to let somebody report.
      className={`fixed bottom-20 right-4 ${ABOVE_EVERYTHING} max-h-[calc(100dvh-7rem)] w-[min(92vw,22rem)] overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl lg:bottom-6 lg:max-h-[calc(100dvh-3rem)]`}
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
    </div>,
    host.current,
  );
}
