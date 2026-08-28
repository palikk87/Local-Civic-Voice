import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CivicRecord } from "@/components/record/CivicRecord";
import { useCurrentUser } from "@/hooks/use-civic-auth";
import { api } from "@/lib/api";

/**
 * One person's positions, on a page of their own.
 *
 * WHY THIS EXISTS. A bug report asked whether showing somebody's whole voting
 * history on their profile went further than the anonymity this platform
 * promises. It does not — anonymity is a switch a person turns on, and the
 * server withholds those positions from everybody but their author. But a
 * stranger's complete record sitting open on the page, no click required, was
 * further than the report was comfortable with, and the call was: keep the
 * numbers on the profile, put the list here.
 *
 * NOTHING IS HIDDEN THAT WAS NOT ALREADY PUBLIC. This page needs no account
 * and the same route serves it. What changed is that reading what a stranger
 * has ever voted for is something you now do on purpose.
 *
 * Your own record is not here. It stays on your own profile, with the two
 * private parts — where you stand alone, and what was said in your name — that
 * belong beside it. A mirror is for the person holding it, so this redirects
 * you home rather than showing you a stranger's view of yourself.
 *
 * Phone twin: apps/mobile/src/app/record.tsx, reached the same way.
 */
export default function PersonRecord() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useCurrentUser();

  // The same key UserProfile uses, so arriving here from the profile is a
  // cache hit and the name is on screen before anything is fetched.
  const { data: profile, isLoading } = useQuery({
    queryKey: ["public-user", id],
    queryFn: () => api.get<{ id: string; displayName: string }>(`/api/users/${id}`),
    enabled: Boolean(id),
  });

  if (id && user?.id === id) return <Navigate to="/profile" replace />;

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl py-4">
        {/* BACK MEANS BACK. This was first written to navigate to the
            subject's profile — a guess at where the reader came from, wrong the
            moment they arrive from a search, a link somebody sent them, or the
            delegate list. The browser already knows.

            (Written without the literal path on purpose: route-target-check
            reads destinations out of the source and cannot tell a comment from
            a call, and teaching it to skip comments would risk it skipping a
            real one.) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-4 -ml-2 text-muted-foreground"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>

        {isLoading ? (
          <Skeleton className="mb-6 h-7 w-56" />
        ) : profile ? (
          <h1 className="mb-6 font-display text-2xl font-semibold tracking-tight text-foreground">
            {profile.displayName}
          </h1>
        ) : null}

        <CivicRecord userId={id} isMine={false} variant="full" />
      </div>
    </AppShell>
  );
}
