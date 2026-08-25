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
