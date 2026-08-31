/**
 * The official portrait of a member of Congress, from their bioguide id.
 *
 * WHY THIS EXISTS AS A FUNCTION. The URL was built by hand in five different
 * places across the two apps, so getting it wrong was five separate bugs and
 * fixing it was five separate edits. It is one line of string building; the
 * value here is that there is exactly one of it.
 *
 * WHY THE URL CHANGED. Every call site used
 *
 *     https://www.congress.gov/img/member/<lowercase-id>_200.jpg
 *
 * which works for most members and 404s for some. Reported as "why isn't there
 * a photo of the rep in every law card", on a bill sponsored by Bernie Moreno
 * — whose bioguide id is M001242, and whose congress.gov image is simply not
 * there. Measured across five ids: that host returned 404 for Moreno and 200
 * for the other four. bioguide.congress.gov returned 200 for all five.
 *
 * The page was never broken. Its `onError` hid the image exactly as designed,
 * because a broken-image icon reads as a bug rather than as a missing
 * photograph — so the failure was invisible and looked like a missing feature.
 *
 * bioguide.congress.gov is the authoritative source: it is the Biographical
 * Directory the ids themselves come from, so a member with an id has a page
 * there. Case does not matter to it; the id is passed through as given.
 *
 * KEEP THE onError. This returns a URL, not a promise that a photograph
 * exists. Some members genuinely have no portrait, and a card must show their
 * name without a broken frame beside it.
 */
export function memberPhotoUrl(bioguideId: string | null | undefined): string | null {
  const id = bioguideId?.trim();
  if (!id) return null;
  return `https://bioguide.congress.gov/photo/${id}.jpg`;
}
