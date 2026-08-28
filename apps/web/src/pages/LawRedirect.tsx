import { Navigate, useParams } from "react-router-dom";

/**
 * /bill/:id, /executive-order/:id and /scotus/:id all land on /reference/:id.
 *
 * WHY. There were four pages for the same thing. Three of them were ports of
 * the phone app, one per branch, and they were what the feed, the timeline,
 * Discover, every card and every notification opened. The fourth —
 * /reference/:id — is the one with the Citizen's Brief, the Integrity Audit,
 * the Pulse history, the turning points, the other side and the comments, and
 * essentially nothing sent anybody to it. It was reachable from a profile's
 * record and little else.
 *
 * Reported plainly: "when clicking see details from feed or timeline or really
 * anywhere the page should look like the new version… right now [it] is only
 * accessible thru the records portion in the profiles".
 *
 * THE IDS ARE THE SAME ONES. Every one of the four routes took a government
 * reference id, so this is a rename rather than a migration — nothing has to be
 * looked up or mapped.
 *
 * REDIRECTS RATHER THAN DELETIONS, for the same reason /record is a redirect:
 * links to these exist in notifications, in shared posts, and in anything
 * anybody has already sent to somebody else. A link that dies is a promise
 * broken by a refactor.
 */
export default function LawRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/reference/${id}` : "/library"} replace />;
}
