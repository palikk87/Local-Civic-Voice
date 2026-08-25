/**
 * Resolved runtime configuration for the mobile app.
 *
 * Every consumer reads from here rather than touching `process.env` directly,
 * because the backend URL previously had three different fallback behaviours for
 * one concept: `auth/auth-client.ts` fell back to localhost, `api/api.ts` used a
 * non-null assertion with no fallback at all (so a missing value became the
 * string "undefined" in request URLs), and the web variant defaulted differently
 * again. Any of those could point auth and data at different hosts.
 *
 * The member expressions below must stay literal. Expo's Babel transform
 * substitutes `process.env.EXPO_PUBLIC_*` at build time by matching the exact
 * text, so a computed lookup like `process.env[name]` silently yields undefined
 * in a release build.
 */

const RAW_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

/**
 * Base URL of the AYE & NAY API.
 *
 * Falls back to localhost only in development. In a release build a missing
 * value throws at import time — loudly, at startup — rather than letting every
 * request fail one by one against a malformed URL.
 */
export const BACKEND_URL: string = (() => {
  if (RAW_BACKEND_URL) return RAW_BACKEND_URL.replace(/\/+$/, "");
  if (__DEV__) return "http://localhost:3000";
  throw new Error(
    "EXPO_PUBLIC_BACKEND_URL is not set. It must be defined at build time — " +
      "Expo inlines EXPO_PUBLIC_* values into the bundle, so setting it at " +
      "runtime has no effect."
  );
})();

const RAW_WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || "";

/**
 * Where a shared link points.
 *
 * WHY THIS EXISTS. Every share sheet sent "Check out this bill: {title}\n\nVote
 * on AYE & NAY!" and no URL — so the recipient had a title, an instruction, and
 * no way to reach the thing. A share with nowhere to go is not a share.
 *
 * The web app can use window.location.origin; a native bundle has no origin, so
 * the public site has to be named at build time like the backend is.
 *
 * NOT THROWING when it is unset, unlike BACKEND_URL. A missing backend breaks
 * every screen and should stop the app at startup; a missing web URL breaks
 * sharing only, and taking the whole app down over it would be the larger
 * fault. shareUrlFor returns null instead, and the callers send the title
 * alone — which is what they did before this existed.
 */
export const WEB_URL: string | null = RAW_WEB_URL
  ? RAW_WEB_URL.replace(/\/+$/, "")
  : __DEV__
    ? "http://localhost:5173"
    : null;

/** A link a recipient can open, or null when no public site is configured. */
export function shareUrlFor(path: string): string | null {
  if (!WEB_URL) return null;
  return `${WEB_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The share body: the title, and the link when there is one. */
export function shareMessage(title: string, path: string): string {
  const url = shareUrlFor(path);
  return url ? `${title}\n\n${url}` : title;
}
