import { Link } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/**
 * A person's name or face, and it goes to their profile.
 *
 * WHY THIS EXISTS. Nothing did. A post showed an author's name and avatar and
 * both were inert text — in the feed, in a comment, in a reply, on a repost
 * attribution, in search results. The only way to reach anybody's profile was
 * the People page, so on a platform whose whole premise is that positions are
 * public and attributable, you could read somebody's argument and have no way
 * to find out what they had ever voted for.
 *
 * One component rather than a Link at each site, because "clickable everywhere"
 * fails the moment somebody adds the twelfth place a name appears and forgets.
 * It also keeps one decision in one place: the click must not swallow a click
 * meant for the card underneath it, which is why `stopPropagation` is here and
 * not repeated at every call site.
 */

interface Person {
  id: string;
  displayName: string;
  username: string;
  avatar?: string | null;
}

export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/** The name, as a link. Renders inline so it drops into a sentence. */
export function PersonName({
  person,
  className,
}: {
  person: Person;
  className?: string;
}) {
  return (
    <Link
      to={`/user/${person.id}`}
      onClick={(e) => e.stopPropagation()}
      className={cn("hover:underline", className)}
    >
      {person.displayName}
    </Link>
  );
}

/** The @handle, as a link. */
export function PersonHandle({
  person,
  className,
}: {
  person: Person;
  className?: string;
}) {
  return (
    <Link
      to={`/user/${person.id}`}
      onClick={(e) => e.stopPropagation()}
      className={cn("hover:underline", className)}
    >
      @{person.username}
    </Link>
  );
}

/** The avatar, as a link. */
export function PersonAvatar({
  person,
  className,
  fallbackClassName,
}: {
  person: Person;
  className?: string;
  fallbackClassName?: string;
}) {
  return (
    <Link
      to={`/user/${person.id}`}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${person.displayName}'s profile`}
      className="shrink-0"
    >
      <Avatar className={className}>
        {person.avatar ? <AvatarImage src={person.avatar} alt="" /> : null}
        <AvatarFallback className={fallbackClassName}>
          {initialsOf(person.displayName || person.username || "?")}
        </AvatarFallback>
      </Avatar>
    </Link>
  );
}
