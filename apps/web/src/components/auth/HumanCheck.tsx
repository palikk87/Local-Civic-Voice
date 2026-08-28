/**
 * THE BOT TEST ON SIGN-UP — Constitution Article I §3.
 *
 * "Only verified humans may vote." A confirmed email address proves an inbox,
 * and inboxes are free and scriptable. This is the widget that asks for a
 * person.
 *
 * IT DRAWS NOTHING WHEN NOTHING IS CONFIGURED. The server says whether a
 * challenge is required (`GET /api/auth-challenge`), and with no key set this
 * renders null and sign-up proceeds — the platform does not pretend to check.
 * That state is reported by name at /health and in the admin key panel, so it
 * is visible somewhere rather than nowhere.
 *
 * THE SCRIPT IS LOADED ONCE AND ONLY WHEN NEEDED. It is not in index.html,
 * because somebody reading a bill should not be fetching Cloudflare's
 * challenge bundle.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Challenge {
  provider: string;
  configured: boolean;
  siteKey: string | null;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

let scriptLoading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the check."));
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/** Read once per page load, so the form knows whether to wait for a token. */
export function useHumanCheck() {
  return useQuery({
    queryKey: ["auth-challenge"],
    queryFn: () => api.get<Challenge>("/api/auth-challenge"),
    staleTime: 60 * 60 * 1000,
  });
}

export function HumanCheck({
  onToken,
}: {
  /** Called with the token, and with null when it expires or fails. */
  onToken: (token: string | null) => void;
}) {
  const { data } = useHumanCheck();
  const holder = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!data?.configured || !data.siteKey || !holder.current) return;
    if (widget.current) return;

    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !holder.current || !window.turnstile || !data.siteKey) return;
        widget.current = window.turnstile.render(holder.current, {
          sitekey: data.siteKey,
          theme: "auto",
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            setFailed(true);
            onToken(null);
          },
        });
      })
      .catch(() => {
        setFailed(true);
        onToken(null);
      });

    return () => {
      cancelled = true;
    };
  }, [data?.configured, data?.siteKey, onToken]);

  // No challenge is configured. Draw nothing — and say nothing, because a
  // notice on the sign-up form telling the world the bot test is off is an
  // invitation. The state is reported where operators look, not to visitors.
  if (!data?.configured) return null;

  return (
    <div data-testid="human-check" className="mt-2">
      <div ref={holder} />
      {failed ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="human-check-failed">
          The check could not load. Refresh and try again.
        </p>
      ) : null}
    </div>
  );
}
