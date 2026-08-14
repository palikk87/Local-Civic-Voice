/**
 * Resolved runtime configuration for the web app.
 *
 * Everything reads the backend URL from here rather than touching
 * `import.meta.env` directly. It previously had two different fallbacks for one
 * value: `lib/api.ts` fell back to `""` while `lib/auth-client.ts` fell back to
 * `undefined`, which Better Auth resolves to `window.location.origin`. With
 * `VITE_BACKEND_URL` unset in a production build, the API client and the auth
 * client would silently target different hosts — data from one place, sessions
 * from another.
 *
 * Note Vite inlines `import.meta.env.VITE_*` at build time by matching the exact
 * text, so the member expression below must stay literal — a computed lookup
 * yields undefined in a production bundle. It also means one build artifact
 * cannot be promoted between environments; staging and production need separate
 * builds.
 */

const RAW_BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? "";

/**
 * Base URL for API and auth requests.
 *
 * Empty string is the correct value for the normal deployment: `vercel.json`
 * rewrites `/api/*` to the API host, so the browser stays on one origin and the
 * session cookie remains first-party. In dev, Vite's proxy does the same job.
 *
 * A trailing slash is stripped so callers can concatenate paths that begin with
 * one without producing `//api/...`.
 */
export const BACKEND_URL: string = RAW_BACKEND_URL.replace(/\/+$/, "");

/**
 * Better Auth resolves `undefined` to `window.location.origin`, which is what we
 * want when requests are proxied same-origin. Passing `""` instead would make it
 * build relative URLs it cannot resolve.
 */
export const AUTH_BASE_URL: string | undefined = BACKEND_URL || undefined;
