import { Navigate, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "@/hooks/use-civic-auth";

/**
 * /record is now a redirect. The record lives on the profile.
 *
 * It used to be its own page with its own item in the sidebar, and it was the
 * only place a person's positions appeared anywhere in the app. So the single
 * thing this platform exists to record sat somewhere other than the profile,
 * and looking somebody up told you their bio and their posts and nothing about
 * what they had ever stood for.
 *
 * The route is kept rather than deleted because links to it exist — in
 * notifications, in the position-review flow, and in anything anybody has
 * already sent to somebody else. A link that dies is a promise broken by a
 * refactor.
 *
 *   /record            → /profile
 *   /record?user=<id>  → /user/<id>
 */
export default function MyRecord() {
  const [searchParams] = useSearchParams();
  const { user, isLoading } = useCurrentUser();
  const viewing = searchParams.get("user");

  if (viewing && viewing !== user?.id) {
    return <Navigate to={`/user/${viewing}`} replace />;
  }

  // Waiting on the session, because redirecting a signed-in person to the
  // sign-in prompt because their session had not arrived yet is its own bug.
  if (isLoading) return null;

  return <Navigate to="/profile" replace />;
}
