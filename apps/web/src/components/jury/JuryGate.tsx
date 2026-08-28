/**
 * SEQUESTRATION, on the screen — Constitution Article IV.
 *
 * A juror who accepted a summons is taken to the decision page and kept there.
 *
 * THIS IS NOT THE ENFORCEMENT. The server is (middleware/sequestration.ts):
 * every route but the case, sign-out, account settings and the bug reporter
 * answers 423 for a sequestered account, so a second browser tab gets the same
 * answer as this one. What this component adds is that the app behaves like it
 * MEANS it rather than showing a wall of errors — a juror should see the case,
 * not five hundred failed requests.
 *
 * A SUMMONS IS NOT A SEQUESTRATION. Somebody who has been called but has not
 * accepted gets a banner, not a redirect: they still have a day to decide, and
 * taking their app away before they said yes would be the platform answering
 * for them.
 */

import { useEffect } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import { juries } from "@/lib/juries";

export function JuryGate() {
  const { isAuthenticated } = useCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();

  const { data } = useQuery({
    queryKey: ["juries", "mine"],
    queryFn: juries.mine,
    enabled: isAuthenticated,
    // A summons arrives while somebody is using the app, so this has to notice
    // without a reload. A minute is far inside the 24-hour window.
    refetchInterval: 60_000,
  });

  const sequestered = data?.sequesteredBy ?? null;
  const onTheCase = sequestered ? location.pathname === `/jury/${sequestered}` : false;

  useEffect(() => {
    if (sequestered && !onTheCase) {
      navigate(`/jury/${sequestered}`, { replace: true });
    }
  }, [sequestered, onTheCase, navigate]);

  const waiting = (data?.summonses ?? []).filter((s) => s.state === "summoned");
  if (sequestered || waiting.length === 0) return null;

  return (
    <div
      data-testid="jury-summons-banner"
      className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2"
    >
      <Link
        to={`/jury/${waiting[0]!.juryId}`}
        className="mx-auto flex max-w-4xl items-center gap-2 text-sm text-foreground"
      >
        <Scale className="h-4 w-4 shrink-0 text-amber-500" />
        <span>
          <strong>You have been called to a jury.</strong> A report is waiting for a decision and
          you were drawn at random. You have a day to answer.
        </span>
      </Link>
    </div>
  );
}
