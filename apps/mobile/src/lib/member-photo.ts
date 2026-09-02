import { BACKEND_URL } from "./config";

/**
 * The official portrait of a member of Congress, from their bioguide id.
 *
 * WHY THIS EXISTS AS A FUNCTION. The URL was built by hand in five different
 * places across the two apps, so getting it wrong was five separate bugs and
 * fixing it was five separate edits. The value here is that there is one of it.
 *
 * WHY IT NO LONGER NAMES CONGRESS.GOV. Every version of this pointed straight
 * at somebody else's server — first `www.congress.gov/img/member/<id>_200.jpg`,
 * then `bioguide.congress.gov/photo/<ID>.jpg` when the first was found to 404
 * on Bernie Moreno. The second host is better and it is still not enough.
 * Measured against all 244 people who have sponsored something on this
 * platform, it has no photograph for four of them — Troy Balderson, Darren
 * Soto, Josh Gottheimer, Darline Graham — and for Ron Johnson it answers with
 * 65,536 bytes that are not an image at all, labelled image/jpeg, every time.
 * Five faces missing, and nothing on this side could tell.
 *
 * So a face is asked of our own server now. It answers from a portrait we
 * already hold, or fetches the person once from whichever of four sources has
 * one, checks the bytes really are a picture, and keeps it — so the gap closes
 * itself the first time anybody looks. See backend/src/routes/portraits.ts.
 *
 * KEEP THE onError. This returns a URL, not a promise that a photograph exists.
 * Some people genuinely have none — Everton Blair has no published portrait
 * anywhere we know of — and a card must show their name without a broken frame
 * beside it.
 */
export function memberPhotoUrl(bioguideId: string | null | undefined): string | null {
  const id = bioguideId?.trim();
  if (!id) return null;
  return `${BACKEND_URL}/api/portraits/${id}.jpg`;
}
